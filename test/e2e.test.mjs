// End-to-end over the git board with a bare repository on disk and the mock runner:
// claim -> agent edit -> policy -> sandboxed verify -> signed receipt -> submit -> independent
// review -> merge -> ledger. No network, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'swarm.mjs');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-e2e-')));
const remote = path.join(tmp, 'remote.git');
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_GLOBAL: '/dev/null' };
// Nested OS sandboxes are not possible, and CI machines may have none: fall back to no sandbox there.
// SWARM_TEST_SANDBOX=auto makes Linux use its real sandbox (bubblewrap) instead of none.
const nested = Boolean(process.env.SWARM_SANDBOX) || (process.platform !== 'darwin' && process.env.SWARM_TEST_SANDBOX !== 'auto');
const SANDBOX = nested ? ['--unsafe-no-sandbox'] : [];

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${r.stderr}`);
  return r.stdout;
}

function swarm(home, args, env = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    env: { ...process.env, ...GIT_ENV, NO_COLOR: '1', SWARM_HOME: path.join(tmp, home), ...env },
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout + r.stderr, stdout: r.stdout };
}

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

test.before(() => {
  const seed = path.join(tmp, 'seed');
  write(
    path.join(seed, '.swarm/projects/demo/project.json'),
    JSON.stringify({ name: 'Demo', paths: ['src/**'], protect: ['check.mjs'], verify: [{ name: 'check', run: 'node check.mjs' }], review: { quorum: 1, maxRejections: 2, tiers: [{ paths: ['src/rule.mjs'], quorum: 2 }] } }),
  );
  write(path.join(seed, '.swarm/projects/demo/tasks/add-greeting.md'), '---\ntitle: Add a greeting module\nsize: S\n---\nCreate src/greet.mjs exporting greet(name).\n');
  write(path.join(seed, '.swarm/projects/demo/tasks/add-farewell.md'), '---\ntitle: Add a farewell module\nsize: S\n---\nCreate src/bye.mjs.\n');
  write(path.join(seed, '.swarm/projects/demo/tasks/add-thanks.md'), '---\ntitle: Add a thanks module\nsize: S\n---\nCreate src/thanks.mjs.\n');
  write(path.join(seed, '.swarm/projects/demo/tasks/add-hello.md'), '---\ntitle: Add a hello module\nsize: S\n---\nCreate src/hello.mjs.\n');
  write(path.join(seed, '.swarm/projects/demo/tasks/change-rule.md'), '---\ntitle: Change a rule file\nsize: S\n---\nCreate src/rule.mjs.\n');
  write(path.join(seed, 'check.mjs'), "import fs from 'node:fs';\nfor (const f of fs.readdirSync('src')) { const m = await import('./src/' + f); if (typeof Object.values(m)[0] !== 'function') process.exit(1); }\n");
  write(path.join(seed, 'src/index.mjs'), 'export const main = () => 1;\n');
  sh('git', ['init', '-q', '-b', 'main'], seed);
  sh('git', ['add', '-A'], seed);
  sh('git', ['commit', '-q', '-m', 'seed'], seed);
  sh('git', ['init', '-q', '--bare', '-b', 'main', remote], tmp);
  sh('git', ['push', '-q', remote, 'main'], seed);
  for (const h of ['alice', 'bob', 'carol']) assert.equal(swarm(h, ['init', '--handle', h]).code, 0);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const branches = () => sh('git', ['for-each-ref', '--format=%(refname)', 'refs/heads/swarm'], remote).split('\n').filter(Boolean);
const run = (home, task, mock, extra = []) => swarm(home, ['run', '--repo', remote, '--runner', 'mock', '--task', task, ...SANDBOX, ...extra], { SWARM_MOCK_CMD: mock });
const GOOD = "printf 'export const greet = (n) => `hi ${n}`;\\n' > src/greet.mjs && echo 'Added greet.'";

test('a change that breaks the path policy is never submitted', () => {
  const r = run('alice', 'demo/add-greeting', 'echo "process.exit(0)" > check.mjs');
  assert.match(r.out, /Policy: check\.mjs is protected/);
  assert.match(r.out, /0 submitted, 1 failed/);
  assert.deepEqual(branches(), []);
});

test('a change that fails verification is never submitted, and the claim is released', () => {
  const r = run('alice', 'demo/add-greeting', "echo 'export const x = 1;' > src/greet.mjs");
  assert.match(r.out, /Verification failed at "check"/);
  assert.deepEqual(branches(), []);
  assert.match(swarm('alice', ['tasks', '--repo', remote, '--json']).out, /"ref": "demo\/add-greeting",[^}]*"state": "open"/s);
});

test('two workers racing for one task: exactly one submission', async () => {
  const { spawn } = await import('node:child_process');
  const start = (home) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [BIN, 'run', '--repo', remote, '--runner', 'mock', '--task', 'demo/add-farewell', ...SANDBOX], {
        env: { ...process.env, ...GIT_ENV, NO_COLOR: '1', SWARM_HOME: path.join(tmp, home), SWARM_MOCK_CMD: "sleep 1; echo 'export const bye = () => 0;' > src/bye.mjs" },
      });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      p.on('close', () => resolve(out));
    });
  const outs = await Promise.all([start('alice'), start('bob')]);
  assert.equal(outs.filter((o) => /Submitted demo\/add-farewell/.test(o)).length, 1, outs.join('\n---\n'));
  assert.equal(branches().filter((b) => b.includes('add-farewell')).length, 1);
});

test('submit, independent review, merge, ledger', () => {
  const r = run('alice', 'demo/add-greeting', GOOD);
  assert.match(r.out, /Submitted demo\/add-greeting/, r.out);
  assert.equal(branches().filter((b) => b.includes('add-greeting')).length, 1);

  // The task is taken now.
  assert.match(run('bob', 'demo/add-greeting', GOOD).out, /is not open/);

  // The submitter cannot review their own work.
  assert.match(swarm('alice', ['review', '--repo', remote, '--runner', 'mock', '--task', 'demo/add-greeting', ...SANDBOX], { SWARM_MOCK_CMD: 'echo "VERDICT: APPROVE"' }).out, /Nothing to review/);

  // Merging without a review is refused.
  const early = swarm('carol', ['merge', 'demo/add-greeting', '--repo', remote, ...SANDBOX]);
  assert.notEqual(early.code, 0);
  assert.match(early.out, /Needs 1 independent approval/);

  const rv = swarm('bob', ['review', '--repo', remote, '--runner', 'mock', '--task', 'demo/add-greeting', ...SANDBOX], { SWARM_MOCK_CMD: 'printf "Does what the task asks.\\nVERDICT: APPROVE\\n"' });
  assert.match(rv.out, /Verification reproduced/, rv.out);
  assert.match(rv.out, /Review posted: approve/);

  const merged = swarm('carol', ['merge', 'demo/add-greeting', '--repo', remote, ...SANDBOX]);
  assert.match(merged.out, /Merged demo\/add-greeting/, merged.out);

  const files = sh('git', ['ls-tree', '-r', '--name-only', 'main'], remote);
  assert.match(files, /src\/greet\.mjs/);
  assert.match(files, /\.swarm\/receipts\/demo\/add-greeting\/[0-9a-f]{16}\.json/);
  assert.match(swarm('carol', ['tasks', '--repo', remote, '--json']).out, /"ref": "demo\/add-greeting",[^}]*"state": "done"/s);
  // Merging leaves no coordination refs behind.
  assert.equal(sh('git', ['for-each-ref', '--format=%(refname)', 'refs/swarm/reviews/demo/add-greeting', 'refs/swarm/claims/demo/add-greeting', 'refs/heads/swarm/demo/add-greeting'], remote).trim(), '');
  const ledger = JSON.parse(swarm('carol', ['ledger', '--repo', remote, '--json']).stdout); // --json: stdout is the document, nothing else
  assert.equal(ledger.totals.tasks, 1);
  assert.equal(ledger.workers[0].handle, 'alice');
});

test('choosing projects', () => {
  assert.match(swarm('carol', ['choose']).out, /No projects chosen yet/);
  assert.match(swarm('carol', ['choose', `${remote}#demo`]).out, /Your quota goes to:/);
  assert.match(swarm('carol', ['tasks', '--json']).out, /"ref": "demo\/add-greeting"/);
  assert.match(swarm('carol', ['choose', `${remote}#demo`, '--remove']).out, /No projects chosen yet/);
});

test('a tampered submission is rejected by the structural check', () => {
  // Bob rewrites Alice's merged receipt into a "submission" for the other task with a forged tree.
  const work = path.join(tmp, 'forge');
  sh('git', ['clone', '-q', remote, work], tmp);
  const farewell = branches().find((b) => b.includes('add-farewell')).replace('refs/heads/', '');
  sh('git', ['checkout', '-q', farewell], work);
  const receiptFile = sh('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], work).trim();
  const receipt = JSON.parse(fs.readFileSync(path.join(work, receiptFile), 'utf8'));
  receipt.usage.costUsd = 9999; // inflate the donation without re-signing
  fs.writeFileSync(path.join(work, receiptFile), JSON.stringify(receipt, null, 2));
  sh('git', ['commit', '-q', '--amend', '-a', '-m', 'forged'], work);
  sh('git', ['push', '-q', '--force', 'origin', farewell], work);
  const rv = swarm('carol', ['review', '--repo', remote, '--runner', 'mock', '--task', 'demo/add-farewell', ...SANDBOX], { SWARM_MOCK_CMD: 'echo "VERDICT: APPROVE"' });
  assert.match(rv.out, /Not reviewable: .*bad signature/s, rv.out);
});

test('maintain: one agent re-tests, reviews and merges what another agent submitted', () => {
  const THANKS = "echo 'export const thanks = () => 1;' > src/thanks.mjs";
  assert.match(run('alice', 'demo/add-thanks', THANKS).out, /Submitted demo\/add-thanks/);
  const maintain = (home) => swarm(home, ['maintain', '--repo', remote, '--runner', 'mock', ...SANDBOX], { SWARM_MOCK_CMD: 'printf "Does what the task asks.\\nVERDICT: APPROVE\\n"' });

  // The submitter's own maintain pass cannot approve or merge its own work.
  const own = maintain('alice');
  assert.match(own.out, /demo\/add-thanks .*Needs 1 independent approval.*your own submission/s, own.out);
  assert.doesNotMatch(own.out, /Merged demo\/add-thanks/);

  // A different worker's pass reviews it and merges it, and steps over the forged submission.
  const other = maintain('bob');
  assert.match(other.out, /Review posted: approve/, other.out);
  assert.match(other.out, /Merged demo\/add-thanks/);
  assert.match(other.out, /demo\/add-farewell .*not valid/s);
  assert.match(other.out, /1 reviewed, 1 merged/);
  assert.match(sh('git', ['ls-tree', '-r', '--name-only', 'main'], remote), /src\/thanks\.mjs/);
});

test('a change to a rule file needs two different approving agents', () => {
  assert.match(run('alice', 'demo/change-rule', "echo 'export const rule = () => 2;' > src/rule.mjs").out, /Submitted demo\/change-rule/);
  const maintain = (home) => swarm(home, ['maintain', '--repo', remote, '--runner', 'mock', ...SANDBOX], { SWARM_MOCK_CMD: 'printf "Fine.\\nVERDICT: APPROVE\\n"' });

  // One approving agent is not enough for this path, and approving twice does not help.
  const first = maintain('bob');
  assert.match(first.out, /Review posted: approve/, first.out);
  assert.match(first.out, /demo\/change-rule .*Needs 2 independent approval\(s\); has 1/s);
  assert.match(maintain('bob').out, /Needs 2 independent approval\(s\); has 1/);
  assert.doesNotMatch(sh('git', ['ls-tree', '-r', '--name-only', 'main'], remote), /src\/rule\.mjs/);

  // A second, different worker's agent approves, and it merges.
  const second = maintain('carol');
  assert.match(second.out, /Review posted: approve/, second.out);
  assert.match(second.out, /Merged demo\/change-rule/);
  assert.match(sh('git', ['ls-tree', '-r', '--name-only', 'main'], remote), /src\/rule\.mjs/);
});

test('a rejected submission is closed, the task opens again, and after too many it is parked', () => {
  const HELLO = "echo 'export const hello = () => 1;' > src/hello.mjs";
  const refs = (prefix) => sh('git', ['for-each-ref', '--format=%(refname)', prefix], remote).split('\n').filter(Boolean);
  const state = () => JSON.parse(swarm('alice', ['tasks', '--repo', remote, '--json']).stdout).find((t) => t.ref === 'demo/add-hello').state;
  const maintain = (home, verdict) => swarm(home, ['maintain', '--repo', remote, '--runner', 'mock', ...SANDBOX], { SWARM_MOCK_CMD: `printf "Reasons.\\nVERDICT: ${verdict}\\n"` });

  assert.match(run('alice', 'demo/add-hello', HELLO).out, /Submitted demo\/add-hello/);
  assert.equal(state(), 'claimed');

  // The submitter's own pass has nobody's rejection to act on.
  assert.doesNotMatch(maintain('alice', 'REJECT').out, /Closed demo\/add-hello/);

  // Another worker's agent rejects it: the submission goes away and the task is open again.
  const first = maintain('bob', 'REJECT');
  assert.match(first.out, /Review posted: reject/, first.out);
  assert.match(first.out, /Closed demo\/add-hello .*rejected in review\. The task is open for another attempt/);
  assert.match(first.out, /1 closed after rejection/);
  assert.deepEqual(refs('refs/heads/swarm/demo/add-hello'), []);
  assert.deepEqual(refs('refs/swarm/reviews/demo/add-hello'), []);
  assert.equal(refs('refs/swarm/rejected/demo/add-hello').length, 1);
  assert.equal(state(), 'open');

  // The next worker's agent is told that review is where the last attempt ended.
  const TOLD = `printf '%s' "$SWARM_PROMPT" | grep -q 'did not get past: review (1x)' && ${HELLO}`;
  assert.match(run('carol', 'demo/add-hello', TOLD).out, /Submitted demo\/add-hello/);

  // A second rejection reaches this project's limit of two: the task is parked.
  const second = maintain('bob', 'REJECT');
  assert.match(second.out, /Closed demo\/add-hello .*That is 2 rejections, so the task is parked.*swarm reopen demo\/add-hello/, second.out);
  assert.equal(state(), 'stuck');
  assert.match(run('alice', 'demo/add-hello', HELLO).out, /is not open/);
  assert.match(swarm('alice', ['tasks', '--repo', remote]).out, /stuck +demo\/add-hello[\s\S]*swarm reopen/);

  // A maintainer reopens it. This time the change passes on the worker's machine and fails on the
  // reviewer's, so no agent is asked: that rejection closes the submission just the same.
  assert.match(swarm('bob', ['reopen', 'demo/add-hello', '--repo', remote]).out, /Reopened demo\/add-hello/);
  const HERE_ONLY = "echo 'export const hello = import.meta.url.includes(\"/review-\") ? 1 : () => 1;' > src/hello.mjs";
  assert.match(run('alice', 'demo/add-hello', HERE_ONLY).out, /Submitted demo\/add-hello/);
  const third = maintain('bob', 'APPROVE');
  assert.match(third.out, /Review posted: reject/, third.out);
  assert.match(third.out, /Closed demo\/add-hello .*The task is open for another attempt/);
  assert.equal(state(), 'open');

  // A maintainer reopens it; the next submission is approved and merged, and no record is left behind.
  assert.match(swarm('bob', ['reopen', 'demo/add-hello', '--repo', remote]).out, /Reopened demo\/add-hello/);
  assert.equal(state(), 'open');
  assert.match(run('alice', 'demo/add-hello', HELLO).out, /Submitted demo\/add-hello/);
  assert.match(maintain('carol', 'APPROVE').out, /Merged demo\/add-hello/);
  assert.deepEqual(refs('refs/swarm/rejected'), []);
  assert.equal(state(), 'done');
});
