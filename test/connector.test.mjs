// The MCP connector end to end, over real stdio, against a bare repository on disk.
// Connector mode needs no model: the test plays the host agent and edits through the file tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { resolveInside } from '../src/session.mjs';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'swarm.mjs');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-mcp-')));
const remote = path.join(tmp, 'remote.git');
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_GLOBAL: '/dev/null' };
// SWARM_TEST_SANDBOX=auto makes Linux use its real sandbox (bubblewrap) instead of none.
const nested = Boolean(process.env.SWARM_SANDBOX) || (process.platform !== 'darwin' && process.env.SWARM_TEST_SANDBOX !== 'auto');

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${r.stderr}`);
  return r.stdout;
}
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

/** A minimal MCP client: one JSON-RPC message per line. */
// Every server started here is killed at the end, so a failing test fails instead of hanging.
const children = [];
function connect(home, env = {}) {
  const child = (children[children.length] = spawn(process.execPath, [BIN, 'mcp'], {
    env: { ...process.env, ...GIT_ENV, SWARM_HOME: path.join(tmp, home), ...(nested ? { SWARM_UNSAFE_NO_SANDBOX: '1' } : {}), ...env },
    stdio: ['pipe', 'pipe', 'ignore'],
  }));
  const waiting = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line); // anything that is not protocol on stdout fails the test here
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  });
  let next = 1;
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = next++;
      waiting.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const call = async (name, args = {}) => {
    const res = await request('tools/call', { name, arguments: args });
    const text = res.result.content[0].text;
    return res.result.isError ? { error: text } : JSON.parse(text);
  };
  return { request, call, close: () => child.stdin.end() };
}

test.before(() => {
  const seed = path.join(tmp, 'seed');
  write(
    path.join(seed, '.swarm/projects/demo/project.json'),
    JSON.stringify({ name: 'Demo', paths: ['src/**'], protect: ['check.mjs'], verify: [{ name: 'check', run: 'node check.mjs' }], review: { quorum: 1 } }),
  );
  for (const t of ['one', 'two', 'three']) write(path.join(seed, `.swarm/projects/demo/tasks/${t}.md`), `---\ntitle: Add module ${t}\nsize: S\n---\nCreate src/${t}.mjs exporting a function.\n`);
  write(path.join(seed, 'check.mjs'), "import fs from 'node:fs';\nfor (const f of fs.readdirSync('src')) { const m = await import('./src/' + f); if (typeof Object.values(m)[0] !== 'function') process.exit(1); }\n");
  write(path.join(seed, 'src/index.mjs'), 'export const main = () => 1;\n');
  write(path.join(seed, 'README.md'), 'needle in the readme\n');
  sh('git', ['init', '-q', '-b', 'main'], seed);
  sh('git', ['add', '-A'], seed);
  sh('git', ['commit', '-q', '-m', 'seed'], seed);
  sh('git', ['init', '-q', '--bare', '-b', 'main', remote], tmp);
  sh('git', ['push', '-q', remote, 'main'], seed);
});

test.after(() => {
  for (const child of children) child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const refs = (prefix) => sh('git', ['for-each-ref', '--format=%(refname)', prefix], remote).split('\n').filter(Boolean);

test('protocol: initialize, tool list, unknown method, notification', async () => {
  const c = connect('proto');
  const init = await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'swarm');
  const { tools } = (await c.request('tools/list')).result;
  assert.ok(tools.length >= 15);
  for (const t of tools) assert.equal(t.inputSchema.type, 'object', t.name);
  assert.equal((await c.request('nope/nope')).error.code, -32601);
  const status = await c.call('swarm_status');
  assert.match(status.worker.id, /^[0-9a-f]{16}$/);
  c.close();
});

test('briefing: what the host shows before anything is spent', async () => {
  const c = connect('brief');
  assert.ok((await c.request('tools/list')).result.tools.some((t) => t.name === 'swarm_brief'));
  const b = await c.call('swarm_brief', { repo: remote, probe_quota: false });
  assert.equal(b.quota.known, false);
  assert.equal(typeof b.quota.headline, 'string');
  const demo = b.projects.find((p) => p.id === `${remote}#demo`);
  assert.equal(demo.name, 'Demo');
  assert.equal(demo.chosen, true);
  assert.ok(demo.openTasks >= 1);
  assert.match(b.next.task, /^demo\//);
  assert.equal(b.steps.length, 7);
  assert.equal(b.willRun, true);
  assert.match(b.steps[0], /agent/);
  assert.ok(b.steps[2].startsWith('Accelerating Demo: 1 of '));
  assert.ok(b.steps.every((line) => line.split(/\s+/).length <= 7));
  assert.ok(b.choices.some((ch) => ch.id === demo.id && ch.current));
  assert.ok(b.text.length >= 2);
  // The task it names is one the run can be told to do.
  const begun = await c.call('swarm_begin', { repo: remote, task: b.next.task, agent: 'test-host' });
  assert.equal(begun.task, b.next.task);
  await c.call('swarm_abandon', { session: begun.session, reason: 'test' });
  c.close();
});

test('connector mode: confined file tools, verifier feedback, signed submission', async () => {
  const c = connect('host');
  const begun = await c.call('swarm_begin', { repo: remote, task: 'demo/one', agent: 'test-host', model: 'none' });
  assert.equal(begun.task, 'demo/one', JSON.stringify(begun));
  assert.match(begun.instructions, /swarm_finish/);
  const s = begun.session;
  assert.equal(refs('refs/swarm/claims').length, 1);

  // Reading and searching work; the clone is all there is.
  assert.ok((await c.call('swarm_list', { session: s })).files.includes('src/index.mjs'));
  assert.match((await c.call('swarm_read', { session: s, path: 'src/index.mjs' })).text, /main/);
  assert.match((await c.call('swarm_search', { session: s, pattern: 'needle' })).matches[0], /^README\.md:1:/);

  // The file tools refuse everything outside the task's box.
  assert.match((await c.call('swarm_read', { session: s, path: '../../etc/passwd' })).error, /leaves the repository/);
  assert.match((await c.call('swarm_read', { session: s, path: '/etc/passwd' })).error, /relative/);
  assert.match((await c.call('swarm_read', { session: s, path: '.git/config' })).error, /\.git/);
  assert.match((await c.call('swarm_write', { session: s, path: 'check.mjs', content: 'process.exit(0)' })).error, /protected/);
  assert.match((await c.call('swarm_write', { session: s, path: 'README.md', content: 'x' })).error, /outside the paths/);
  assert.match((await c.call('swarm_write', { session: s, path: '.swarm/projects/demo/project.json', content: '{}' })).error, /protected/);
  assert.match((await c.call('swarm_delete', { session: s, path: 'check.mjs' })).error, /protected/);

  // A wrong change is caught by the sandboxed verifier and comes back as feedback.
  await c.call('swarm_write', { session: s, path: 'src/one.mjs', content: 'export const one = 1;\n' });
  const bad = await c.call('swarm_finish', { session: s, summary: 'first try' });
  assert.equal(bad.ok, false);
  assert.equal(bad.failedStep, 'check');
  assert.equal(bad.attemptsLeft, 2);
  assert.deepEqual(refs('refs/heads/swarm'), []);

  // Fix it with an exact-text edit; ambiguous edits are refused.
  assert.match((await c.call('swarm_edit', { session: s, path: 'src/one.mjs', old_text: 'nope', new_text: 'x' })).error, /not found/);
  await c.call('swarm_edit', { session: s, path: 'src/one.mjs', old_text: 'const one = 1;', new_text: 'const one = () => 1;' });
  const good = await c.call('swarm_finish', { session: s, summary: 'Added src/one.mjs exporting a function.' });
  assert.equal(good.ok, true, JSON.stringify(good));
  assert.deepEqual(good.verified, ['check']);

  // Exactly one submission branch, shaped work + receipt, with the host recorded as self-reported.
  const [branch] = refs('refs/heads/swarm');
  assert.match(branch, /^refs\/heads\/swarm\/demo\/one\//);
  assert.equal(sh('git', ['rev-list', '--count', `main..${branch}`], remote).trim(), '2');
  const receiptFile = sh('git', ['diff', '--name-only', `${branch}~1`, branch], remote).trim();
  const receipt = JSON.parse(sh('git', ['show', `${branch}:${receiptFile}`], remote));
  assert.equal(receipt.agent.runner, 'connector:test-host');
  assert.equal(receipt.agent.selfReported, true);
  assert.equal(receipt.attempts, 2);
  assert.deepEqual(refs('refs/swarm/claims'), []);

  // Asking again returns the stored outcome; the session is closed to further edits.
  assert.equal((await c.call('swarm_finish', { session: s, summary: 'again' })).where, good.where);
  assert.match((await c.call('swarm_write', { session: s, path: 'src/x.mjs', content: 'x' })).error, /submitted/);
  c.close();
});

test('connector mode: abandoning releases the claim; an unfinished session is resumed', async () => {
  const c = connect('host');
  const begun = await c.call('swarm_begin', { repo: remote, task: 'demo/two' });
  assert.equal(refs('refs/swarm/claims').length, 1);
  const again = await c.call('swarm_begin', { repo: remote, task: 'demo/three' });
  assert.equal(again.resumed, true);
  assert.equal(again.session, begun.session);
  const out = await c.call('swarm_abandon', { session: begun.session, reason: 'cannot be done' });
  assert.match(out.problem, /Abandoned/);
  assert.deepEqual(refs('refs/swarm/claims'), []);
  const tasks = (await c.call('swarm_tasks', { repo: remote })).tasks;
  assert.equal(tasks.find((t) => t.task === 'demo/two').state, 'open');
  assert.equal(tasks.find((t) => t.task === 'demo/one').state, 'claimed'); // submitted, awaiting merge
  c.close();
});

test('delegate mode: a background job runs the CLI and can be polled', async () => {
  const c = connect('delegate', { SWARM_MOCK_CMD: "echo 'export const three = () => 3;' > src/three.mjs" });
  const started = await c.call('swarm_donate', { repo: remote, task: 'demo/three', runner: 'mock' });
  assert.equal(started.state, 'running', JSON.stringify(started));
  let status;
  for (let i = 0; i < 120; i++) {
    status = await c.call('swarm_job', { job: started.job });
    if (status.state === 'finished') break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(status.state, 'finished');
  assert.match(status.log, /Submitted demo\/three/, status.log);
  // The finished job is on the last checklist step, and says so in the status line.
  assert.deepEqual({ step: status.progress.step, done: status.progress.done, status: status.progress.status }, { step: 7, done: true, status: 'Pull request opened' });
  assert.equal(refs('refs/heads/swarm').filter((r) => r.includes('/three/')).length, 1);
  c.close();
});

test('shell mode: an agent with its own tools edits the clone, Swarm verifies and submits', () => {
  // This is the path a cloud session takes: no connector, just the CLI printing JSON.
  const env = { ...process.env, ...GIT_ENV, NO_COLOR: '1', SWARM_HOME: path.join(tmp, 'cloud'), CLAUDE_CODE_REMOTE: 'true', SWARM_HANDLE: 'cloud-test' };
  const swarm = (args) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8' });
    return { code: r.status, json: r.stdout.trim() ? JSON.parse(r.stdout) : null, err: r.stderr };
  };
  // The skill runs doctor first and stops if it fails. In a cloud session the VM is the
  // sandbox, so doctor must not apply its isolation self-test there (a real cloud run failed on it).
  const doctor = spawnSync(process.execPath, [BIN, 'doctor'], { env, encoding: 'utf8' });
  assert.match(doctor.stdout + doctor.stderr, /✓ sandbox: cloud-vm/);
  assert.doesNotMatch(doctor.stdout + doctor.stderr, /✗ sandbox/);
  const begun = swarm(['task', 'begin', '--repo', remote, '--task', 'demo/two', '--agent', 'cloud-session']);
  assert.equal(begun.json.task, 'demo/two', begun.err);
  assert.ok(fs.existsSync(path.join(begun.json.workDir, 'src/index.mjs')));
  assert.match(begun.json.instructions, /task finish --session/);
  assert.match(begun.json.instructions, /You may run the verify steps yourself/);

  // Editing a protected file directly is caught by the policy check at the end.
  fs.writeFileSync(path.join(begun.json.workDir, 'check.mjs'), 'process.exit(0)\n');
  const bad = swarm(['task', 'finish', '--session', begun.json.session, '--summary', 'x']);
  assert.equal(bad.code, 1);
  assert.equal(bad.json.failedStep, 'policy');

  sh('git', ['checkout', 'HEAD', '--', 'check.mjs'], begun.json.workDir); // undo the edit, as an agent would
  fs.writeFileSync(path.join(begun.json.workDir, 'src/two.mjs'), 'export const two = () => 2;\n');
  const good = swarm(['task', 'finish', '--session', begun.json.session, '--summary', 'Added src/two.mjs.']);
  assert.equal(good.code, 0, good.err);
  assert.equal(good.json.ok, true);
  assert.equal(good.json.sandbox, 'cloud-vm');

  const [branch] = refs('refs/heads/swarm').filter((r) => r.includes('/two/'));
  const receiptFile = sh('git', ['diff', '--name-only', `${branch}~1`, branch], remote).trim();
  const receipt = JSON.parse(sh('git', ['show', `${branch}:${receiptFile}`], remote));
  assert.equal(receipt.agent.runner, 'shell:cloud-session');
  assert.equal(receipt.signer.handle, 'cloud-test');
  assert.equal(receipt.sandbox, 'cloud-vm');
});

test('a key supplied by the environment signs as the same worker everywhere', () => {
  const home = path.join(tmp, 'idhome');
  const env = { ...process.env, NO_COLOR: '1', SWARM_HOME: home, SWARM_HANDLE: 'porter' };
  const run = (args, extra = {}) => spawnSync(process.execPath, [BIN, ...args], { env: { ...env, ...extra }, encoding: 'utf8' }).stdout.trim();
  run(['init']);
  const id = run(['identity']);
  const blob = run(['identity', 'export']);
  assert.match(id, /^[0-9a-f]{16} \(porter\)$/);
  assert.equal(run(['identity'], { SWARM_HOME: path.join(tmp, 'empty'), SWARM_IDENTITY: blob }), id);
});

test('path confinement survives symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-paths-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-outside-'));
  fs.writeFileSync(path.join(outside, 'secret'), 's');
  fs.symlinkSync(outside, path.join(root, 'link'));
  fs.mkdirSync(path.join(root, 'src'));
  assert.equal(resolveInside(root, 'src/new/file.mjs').rel, 'src/new/file.mjs');
  assert.equal(resolveInside(root, './src/../src/a').rel, 'src/a');
  assert.throws(() => resolveInside(root, 'link/secret'), /leaves the repository/);
  assert.throws(() => resolveInside(root, 'link/new-file'), /leaves the repository/);
  assert.throws(() => resolveInside(root, 'src/../../x'), /leaves the repository/);
  assert.throws(() => resolveInside(root, 'a/.git/hooks/pre-commit'), /\.git/);
  assert.throws(() => resolveInside(root, ''), /required/);
});
