import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBriefing, jobProgress, shortTitle, statusLine } from '../src/briefing.mjs';

const now = new Date('2026-11-18T00:00:00Z');
const registry = [
  { repo: 'acme/tools', project: 'core', name: 'Acme core', description: 'The command-line tool.', languages: ['JavaScript'] },
  { repo: 'acme/tools', project: 'docs', name: 'Acme docs', description: 'Guides and reference.', languages: ['Markdown'] },
  { repo: 'other/lib', project: 'main', name: 'Other lib', description: 'A parsing library.', languages: ['Rust'] },
];
const row = (project, id, size, state = 'open') => ({ project, projectName: project, projectDescription: '', ref: `${project}/${id}`, title: `Do ${id}`, size, state });
const tasksByRepo = {
  'acme/tools': [row('core', 'big', 'M'), row('core', 'small', 'S'), row('core', 'taken', 'S', 'claimed'), row('docs', 'guide', 'S')],
  'other/lib': { error: 'could not reach other/lib' },
};
const rateLimit = { status: 'allowed', weekly: { utilization: 0.6, resetsAt: '2026-11-21T00:00:00Z' }, fiveHour: { utilization: 0.49, resetsAt: '2026-11-18T04:00:00Z' } };

test('says how much quota is left, what Swarm may use, and what it will do next', () => {
  const b = buildBriefing({ rateLimit, decision: { go: true, reason: 'within your limits' }, reserve: 0.2, registry, chosen: ['acme/tools#core'], tasksByRepo, now });
  assert.deepEqual({ used: b.quota.weekly.usedPct, left: b.quota.weekly.leftPct, swarm: b.quota.weekly.swarmCanUsePct }, { used: 60, left: 40, swarm: 20 });
  assert.equal(b.quota.fiveHour.leftPct, 51);
  assert.equal(b.quota.weekly.resetsIn, '3d 0h');
  assert.equal(b.quota.headline, '40% left this week. Swarm uses 20%.');
  // The smallest open task of the chosen project, never a claimed one.
  assert.deepEqual(b.next, { project: 'acme/tools#core', projectName: 'Acme core', task: 'core/small', title: 'Do small', size: 'S', sizeWord: 'small' });
  assert.equal(b.plan, 'Acme core: Do small');
  // The run as a checklist: where the quota stands, which project, which task, then what happens.
  assert.deepEqual(b.steps, [
    'No agents here yet, you start',
    'Contributing 31% quota, expires in 4h 0m',
    'Accelerating Acme core: 1 of 2 tasks',
    'Claim task: Do small',
    'Agent writes the change',
    'Checks run in sandbox',
    'Pull request opens',
  ]);
  assert.equal(b.willRun, true);
  // Blunt on purpose: seven words a line at most.
  for (const line of [...b.steps, ...b.text]) assert.ok(line.split(/\s+/).length <= 7, line);
});

test('the first line counts the other agents on the project, from real claims and submissions', () => {
  const first = (activity) => buildBriefing({ rateLimit, decision: { go: true }, registry, chosen: ['acme/tools#core'], tasksByRepo, activity, now }).steps[0];
  assert.equal(first({ 'acme/tools#core': { finishing: 15, working: 0 } }), '15 agents about to finish');
  assert.equal(first({ 'acme/tools#core': { finishing: 1, working: 0 } }), '1 agent about to finish');
  assert.equal(first({ 'acme/tools#core': { finishing: 2, working: 3 } }), '2 agents finishing, 3 working');
  assert.equal(first({ 'acme/tools#core': { finishing: 0, working: 4 } }), '4 agents working right now');
  // Another project's agents are not this project's.
  assert.equal(first({ 'acme/tools#docs': { finishing: 9, working: 9 } }), 'No agents here yet, you start');
});

test('the quota line names the leftover that expires first', () => {
  const line = (rl) => buildBriefing({ rateLimit: rl, decision: { go: true }, registry, chosen: ['acme/tools#core'], tasksByRepo, now }).steps[1];
  // 5-hour window: 75% used, 25% left; Swarm keeps 20% for the user, so 5% is what it gives.
  assert.equal(line({ weekly: { utilization: 0.5, resetsAt: '2026-11-21T00:00:00Z' }, fiveHour: { utilization: 0.75, resetsAt: '2026-11-18T00:20:00Z' } }), 'Contributing 5% quota, expires in 20m');
  assert.equal(line({ weekly: { utilization: 0.7, resetsAt: '2026-11-18T06:00:00Z' } }), 'Contributing 10% quota, expires in 6h 0m');
  assert.equal(line({ weekly: { utilization: 0.7 } }), 'Contributing 10% of leftover quota');
});

test('the status line under the checklist swaps on every poll', () => {
  const p = { step: 5, now: 'Agent claude writing, attempt 1', done: false };
  const a = statusLine(p, { elapsedMs: 5_000, previous: null });
  assert.deepEqual(a, { text: 'Agent claude writing, attempt 1', showedElapsed: false });
  const b = statusLine(p, { elapsedMs: 50_000, previous: { now: p.now, showedElapsed: false } });
  assert.deepEqual(b, { text: 'Still at it, 50s in', showedElapsed: true });
  const c = statusLine(p, { elapsedMs: 95_000, previous: { now: p.now, showedElapsed: true } });
  assert.equal(c.text, p.now);
  const moved = statusLine({ ...p, step: 6, now: 'Running check: unit-tests' }, { elapsedMs: 120_000, previous: { now: p.now, showedElapsed: false } });
  assert.equal(moved.text, 'Running check: unit-tests');
  assert.equal(statusLine({ step: 7, now: 'Pull request opened', done: true }, { previous: { now: 'Pull request opened', showedElapsed: false } }).text, 'Pull request opened');
  for (const t of [a, b, c, moved]) assert.ok(t.text.split(' ').length <= 7, t.text);
});

test('long task titles are cut to a few words', () => {
  assert.equal(shortTitle('Add a README badge showing a project\'s verified task count'), 'Add a README badge showing…');
  assert.equal(shortTitle('Add `swarm lint` now'), 'Add swarm lint now');
  const b = buildBriefing({ registry, chosen: ['acme/tools#core'], tasksByRepo: { 'acme/tools': [{ ...row('core', 'x', 'S'), title: 'Write the troubleshooting guide for the messages people actually hit' }] }, now });
  assert.equal(b.steps[3], 'Claim task: Write the troubleshooting guide for…');
  assert.equal(buildBriefing({ registry: [{ repo: 'a/b', project: 'p', name: 'A very long project name', description: '' }], chosen: ['a/b#p'], tasksByRepo: { 'a/b': [row('p', 'x', 'S')] }, now }).steps[2], 'Accelerating A very…: 1 of 1 task');
  for (const line of b.steps) assert.ok(line.split(/\s+/).length <= 7, line);
});

test('a running job says which step it is on, in a few words', () => {
  const log = ['› Syncing acme/tools', '› Checking your quota', '  5-hour: 21% used; weekly: 39% used'];
  assert.deepEqual(jobProgress(''), { step: 0, now: 'Starting', done: false });
  assert.deepEqual(jobProgress(log.join('\n')), { step: 2, now: 'Checking quota', done: false });
  // A review of someone else's work comes first; its checks are not this run's task.
  log.push('› Reviewing core/other from worker 0123abcd (#7)', '›   unit-tests: node --test', '✗ Review posted: reject → #7');
  assert.deepEqual(jobProgress(log.join('\n')), { step: 3, now: 'Reviewing core/other for another agent', done: false });
  log.push('› Claiming core/small: Do small');
  assert.deepEqual(jobProgress(log.join('\n')), { step: 4, now: 'Claiming core/small', done: false });
  log.push('› Agent claude working (attempt 1/2, budget $3.00)');
  // The rejection posted before the claim is not a problem with this task.
  assert.deepEqual(jobProgress(log.join('\n')), { step: 5, now: 'Agent claude writing, attempt 1', done: false });
  log.push('› Verifying in seatbelt sandbox');
  assert.equal(jobProgress(log.join('\n')).now, 'Running checks in sandbox');
  log.push('›   unit-tests: node --test test/*.test.mjs');
  assert.deepEqual(jobProgress(log.join('\n')), { step: 6, now: 'Running check: unit-tests', done: false });
  log.push('✗ Verify step "unit-tests" (node --test) exited 1.', '› Agent claude working (attempt 2/2, budget $3.00)');
  const retry = jobProgress(log.join('\n'));
  assert.equal(retry.now, 'Agent claude writing, attempt 2');
  assert.match(retry.problem, /^Verify step "unit-tests"/);
  log.push('› Verifying in seatbelt sandbox', '✓ Verified: unit-tests (2 files, 30 lines)');
  assert.deepEqual(jobProgress(log.join('\n')), { step: 7, now: 'Opening pull request', done: false });
  log.push('✓ Submitted core/small → https://github.com/acme/tools/pull/9  ($0.08 API-equivalent, 40s)');
  assert.deepEqual(jobProgress(log.join('\n')), { step: 7, now: 'Pull request opened', done: true, pullRequest: 'https://github.com/acme/tools/pull/9' });
  assert.deepEqual(jobProgress('› Checking your quota\n! Not donating now: weekly quota is 85% used. Use --force to override.'), { step: 2, now: 'Reserve reached, nothing spent', done: true });
  for (const l of [1, 3, 4, 6, 8, 9, 10]) assert.ok(jobProgress(log.slice(0, l).join('\n')).now.split(' ').length <= 7);
});

test('lists every project with enough to choose from, the chosen one first', () => {
  const b = buildBriefing({ rateLimit, decision: { go: true }, registry, chosen: ['acme/tools#core'], tasksByRepo, now });
  assert.deepEqual(b.projects.map((p) => [p.id, p.chosen, p.openTasks]), [
    ['acme/tools#core', true, 2],
    ['acme/tools#docs', false, 1],
    ['other/lib#main', false, null],
  ]);
  assert.equal(b.projects[0].url, 'https://github.com/acme/tools');
  assert.deepEqual(b.projects[0].examples, ['Do small', 'Do big']);
  assert.equal(b.projects[2].unreachable, 'could not reach other/lib');
  const docs = b.choices.find((c) => c.id === 'acme/tools#docs');
  assert.equal(docs.label, 'Acme docs');
  assert.equal(docs.description, 'Guides and reference. 1 open. E.g. "Do guide".');
  assert.equal(docs.current, false);
  assert.ok(b.choices.every((c) => c.label.length <= 28 && c.description.length <= 220));
  assert.ok(b.text.includes('Also open: Acme docs (1)'));
  assert.ok(!JSON.stringify(b).includes('_open'));
});

test('a whole repository can be chosen, and the default is said to be the default', () => {
  const b = buildBriefing({ registry, chosen: ['acme/tools'], usingDefault: true, tasksByRepo, now });
  assert.deepEqual(b.projects.filter((p) => p.chosen).map((p) => p.id), ['acme/tools#core', 'acme/tools#docs']);
  assert.equal(b.usingDefault, true);
});

test('when the reserve is reached nothing is spent, and it says why', () => {
  const b = buildBriefing({ rateLimit: { weekly: { utilization: 0.85 } }, decision: { go: false, reason: 'weekly quota is 85% used' }, registry, chosen: ['acme/tools#core'], tasksByRepo, now });
  assert.equal(b.quota.go, false);
  assert.equal(b.quota.weekly.swarmCanUsePct, 0);
  assert.equal(b.quota.headline, 'Reserve reached: 85% used. Nothing spent.');
  assert.equal(b.plan, 'Nothing spent.');
  assert.deepEqual(b.steps, ['No agents here yet, you start', 'Quota: 85% used, reserve reached', 'Nothing spent']);
  assert.equal(b.willRun, false);
});

test('unknown quota is stated, not guessed', () => {
  const cloud = buildBriefing({ cloud: true, registry, chosen: ['acme/tools#core'], tasksByRepo, now });
  assert.equal(cloud.quota.known, false);
  assert.equal(cloud.quota.headline, 'Quota unknown in the cloud.');
  assert.equal(cloud.steps[1], 'Contributing quota, amount unknown here');
  assert.equal(cloud.quota.weekly, undefined);
  assert.match(buildBriefing({ registry, chosen: [], tasksByRepo: {}, now }).quota.headline, /^Quota unknown here\./);
});

test('nothing open in the chosen project: suggests one that has work', () => {
  const b = buildBriefing({ rateLimit, decision: { go: true }, registry, chosen: ['acme/tools#core'], tasksByRepo: { 'acme/tools': [row('core', 'taken', 'S', 'claimed'), row('docs', 'guide', 'S')] }, now });
  assert.equal(b.next, null);
  assert.deepEqual(b.suggestion, { project: 'acme/tools#docs', name: 'Acme docs', reason: 'Nothing open in your project. Acme docs has 1.' });
  assert.equal(b.plan, b.suggestion.reason);
  assert.deepEqual(b.steps, ['No agents here yet, you start', 'Contributing 31% quota, expires in 4h 0m', 'Nothing open, nothing spent']);
  assert.equal(b.willRun, false);
});

test('a project that is not in the registry still shows up once chosen', () => {
  const b = buildBriefing({ registry: [], chosen: ['me/thing#app'], tasksByRepo: { 'me/thing': [{ project: 'app', projectName: 'My app', projectDescription: 'An app.', ref: 'app/x', title: 'Do x', size: 'L', state: 'open' }] }, now });
  assert.deepEqual(b.projects.map((p) => [p.id, p.name, p.description, p.chosen]), [['me/thing#app', 'My app', 'An app.', true]]);
  assert.equal(b.next.sizeWord, 'large');
});

test('no run where the result could not be submitted: nothing is spent, and nothing is asked of the user', () => {
  const access = { 'acme/tools': { ok: false, reason: 'the GitHub login here is missing or expired' } };
  const b = buildBriefing({ rateLimit, decision: { go: true }, registry, chosen: ['acme/tools#core'], tasksByRepo, access, now });
  assert.equal(b.willRun, false);
  assert.equal(b.next, null);
  assert.deepEqual(b.blocked, { project: 'acme/tools#core', reason: 'the GitHub login here is missing or expired' });
  assert.deepEqual(b.steps, ['Cannot submit from here', 'No task started, nothing spent']);
  // It does not send the user to another project they could not submit to either.
  assert.equal(b.suggestion, null);
  assert.equal(b.projects.find((p) => p.id === 'acme/tools#core').canSubmit, false);
  for (const line of [...b.steps, ...b.text]) assert.ok(line.split(/\s+/).length <= 7, line);

  // Able to submit, or not asked: the run goes ahead as before.
  assert.equal(buildBriefing({ rateLimit, decision: { go: true }, registry, chosen: ['acme/tools#core'], tasksByRepo, access: { 'acme/tools': { ok: true, route: 'fork' } }, now }).willRun, true);
  assert.equal(buildBriefing({ rateLimit, decision: { go: true }, registry, chosen: ['acme/tools#core'], tasksByRepo, now }).blocked, null);

  // A chosen project that cannot be reached at all is the same outcome, not "nothing open".
  const lost = buildBriefing({ rateLimit, decision: { go: true }, registry, chosen: ['other/lib#main'], tasksByRepo, now });
  assert.equal(lost.willRun, false);
  assert.equal(lost.steps[0], 'Cannot submit from here');
  assert.match(lost.blocked.reason, /could not be reached/);
});

test('a job that could not submit says so in a few words and is finished', () => {
  const refused = jobProgress('› Syncing acme/tools\n› Checking your quota\n! Cannot submit from here: the GitHub login here is missing or expired. No task was started and no quota was spent on one.\n\nSession: 0 submitted, 0 failed, $0.00 API-equivalent quota used.');
  assert.deepEqual(refused, { step: 2, now: 'Cannot submit from here, nothing spent', done: true });
  const kept = jobProgress('› Agent mock working (attempt 1/2, budget $3.00)\n› Verifying in seatbelt sandbox\n✓ Verified: check (1 files, 1 lines)\n! Work kept: core/small is verified but could not be submitted now (network down). Swarm submits it on the next run.');
  assert.deepEqual(kept, { step: 7, now: 'Kept, goes out next run', done: true });
});

test('when the short window is the one at its reserve, the line gives that number', () => {
  const tight = { status: 'allowed', weekly: { utilization: 0.67, resetsAt: '2026-11-21T00:00:00Z' }, fiveHour: { utilization: 0.83, resetsAt: '2026-11-18T04:00:00Z' } };
  const b = buildBriefing({ rateLimit: tight, decision: { go: false, reason: '5-hour window is 83% used' }, reserve: 0.2, registry, chosen: ['acme/tools#core'], tasksByRepo, now });
  assert.equal(b.steps[1], 'Quota: 83% used, reserve reached');
});
