// The reviewer eval (eval/review) without a model: the cases are honest, the agent sees what a
// real review gives it and nothing more, and the scoring is right. The eval itself needs a real
// agent and is run by hand: node eval/review/run.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pickSandbox } from '../src/sandbox.mjs';
import { loadCases, materialize, checksPass, grade, runEval, summarize, promptFingerprint, barePrompt, parseFound } from '../eval/review/lib.mjs';

// Nested OS sandboxes are not possible, and CI machines may have none: fall back to no sandbox there.
const nested = Boolean(process.env.SWARM_SANDBOX) || (process.platform !== 'darwin' && process.env.SWARM_TEST_SANDBOX !== 'auto');
const cases = loadCases();
const fake = (reply) => ({ name: 'fake', seen: [], async runAgent(call) { this.seen.push(call); return { ok: true, model: 'fake', summary: typeof reply === 'function' ? reply(call) : reply, usage: { costUsd: 0 } }; } });

test('the case set has planted problems and clean controls', () => {
  const bad = cases.filter((c) => c.kind === 'bad');
  const clean = cases.filter((c) => c.kind === 'clean');
  assert.ok(bad.length >= 8, `only ${bad.length} bad cases`);
  assert.ok(clean.length >= 3, `only ${clean.length} clean cases`);
  for (const c of bad) assert.ok(c.key.test(c.answer), `${c.id}: the key does not match the case's own answer sentence`);
  // Every task has a clean change, so a reviewer cannot score well by rejecting a whole task.
  for (const c of bad) assert.ok(clean.some((k) => k.task.ref === c.task.ref), `${c.id}: no clean control for ${c.task.ref}`);
});

test('every change passes the fixture checks, so only the reviewer can catch what is planted', async () => {
  const sandbox = nested ? 'none' : await pickSandbox({});
  for (const c of cases) {
    const res = await checksPass(c, { sandbox });
    assert.ok(res.ok, `${c.id} fails its own checks:\n${res.output}`);
  }
});

test('the agent gets the task, the diff and a read-only checkout, and never the answer', async () => {
  const c = cases.find((x) => x.id === 'slug-separators--hard-coded');
  const runner = fake((call) => `${fs.readdirSync(call.cwd).sort().join(',')}\nVERDICT: REJECT`);
  const [r] = await runEval({ cases: [c], runner });
  const call = runner.seen[0];
  assert.equal(call.readOnly, true);
  assert.match(call.prompt, /collapse runs of separators/);
  assert.match(call.prompt, /\+  if \(text === ' {2}Hello, {3}World! '\) return 'hello-world';/);
  assert.ok(!call.prompt.includes(c.answer), 'the answer key leaked into the prompt');
  assert.equal(r.notes, '.git,README.md,package.json,src,templates,test'); // no case.json in the checkout
  assert.equal(fs.existsSync(path.dirname(call.cwd)), false, 'the throwaway repository was not removed');
});

test('scoring: caught needs a rejection for the planted reason', () => {
  const bad = cases.find((x) => x.id === 'duration-days--wrong-value');
  const clean = cases.find((x) => x.id === 'duration-days--clean');
  assert.equal(grade(bad, 'reject', 'A day is 86400 seconds, not 1440.'), 'caught');
  assert.equal(grade(bad, 'reject', 'I do not like the variable names.'), 'rejected-other-reason');
  assert.equal(grade(bad, 'approve', 'Looks right.'), 'missed');
  assert.equal(grade(bad, null), 'no-verdict');
  assert.equal(grade(clean, 'approve'), 'approved');
  assert.equal(grade(clean, 'reject', 'anything'), 'false-reject');
});

test('a reviewer that approves everything scores zero, and one that rejects everything is not rewarded', async () => {
  const yes = summarize(await runEval({ cases, runner: fake('Fine.\nVERDICT: APPROVE') }));
  assert.equal(yes.caught, 0);
  assert.equal(yes.missed, yes.bad);
  assert.equal(yes.recall, 0);
  assert.equal(yes.falseRejects, 0);

  const no = summarize(await runEval({ cases, runner: fake('No.\nVERDICT: REJECT') }));
  assert.equal(no.caught, 0);
  assert.equal(no.rejectedOtherReason, no.bad);
  assert.equal(no.falseRejects, no.clean);
  assert.equal(no.falseRejectRate, 1);
});

test('runs repeat each case, and the prompt fingerprint is stable', async () => {
  const results = await runEval({ cases: cases.slice(0, 2), runner: fake('VERDICT: APPROVE'), runs: 3 });
  assert.equal(results.length, 6);
  assert.deepEqual(results.map((r) => r.run), [1, 2, 3, 1, 2, 3]);
  assert.match(promptFingerprint(), /^[0-9a-f]{12}$/);
  assert.equal(promptFingerprint(), promptFingerprint());
});

test('the bare prompt carries the task and the diff and none of the review checklist', async () => {
  const runner = fake('VERDICT: APPROVE');
  await runEval({ cases: cases.slice(0, 1), runner, buildPrompt: barePrompt });
  const { prompt } = runner.seen[0];
  assert.ok(prompt.includes(cases[0].task.title) && prompt.includes('```diff') && prompt.includes('VERDICT: REJECT'));
  assert.ok(!/cheat|checklist|weakened/i.test(prompt));
  assert.notEqual(promptFingerprint(barePrompt), promptFingerprint());
});

test('materialize makes base and change commits', async () => {
  const m = await materialize(cases.find((x) => x.id === 'wrap--clean'));
  try {
    assert.notEqual(m.base, m.work);
    assert.match(m.diffText, /\+\+\+ b\/src\/wrap\.mjs/);
    assert.ok(fs.existsSync(path.join(m.dir, 'src/slug.mjs')));
  } finally {
    m.cleanup();
  }
});

test('a judge decides whether a rejection named the planted problem, and the keyword is the fallback', async () => {
  const c = cases.find((x) => x.id === 'seatbelt--leaky-loopback');
  // This review says the opposite of the planted problem and still contains the keyword.
  const review = 'The profile blocks connections to other machines, as it should. I reject it for style.\nVERDICT: REJECT';
  const reviewer = fake(review);
  assert.equal((await runEval({ cases: [c], runner: reviewer }))[0].outcome, 'caught'); // keyword alone is fooled

  const judge = (answer) => ({ runner: fake(answer), model: 'judge-model' });
  let judgeSaw;
  const no = judge((call) => ((judgeSaw = fs.readdirSync(call.cwd)), 'It rejects for style.\nFOUND: NO'));
  const [r] = await runEval({ cases: [c], runner: reviewer, judge: no });
  assert.equal(r.outcome, 'rejected-other-reason');
  assert.equal(r.gradedBy, 'judge');
  const asked = no.runner.seen[0];
  assert.equal(asked.model, 'judge-model');
  assert.ok(asked.prompt.includes(c.answer) && asked.prompt.includes('I reject it for style'));
  assert.deepEqual(judgeSaw, [], 'the judge should not be given the code');

  assert.equal((await runEval({ cases: [c], runner: fake('Too long.\nVERDICT: REJECT'), judge: judge('FOUND: YES') }))[0].outcome, 'caught');
  const [fallback] = await runEval({ cases: [c], runner: reviewer, judge: judge('no idea') });
  assert.equal(fallback.outcome, 'caught');
  assert.equal(fallback.gradedBy, 'keyword');

  // Approvals and clean cases are never sent to the judge.
  const idle = judge('FOUND: YES');
  await runEval({ cases: [c, cases.find((x) => x.id === 'seatbelt--clean')], runner: fake('VERDICT: APPROVE'), judge: idle });
  assert.equal(idle.runner.seen.length, 0);
  assert.equal(parseFound('x\nFOUND: yes'), true);
  assert.equal(parseFound('maybe'), null);
});
