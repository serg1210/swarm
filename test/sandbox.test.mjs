// The same isolation checks, run against every sandbox this machine has.
//
//   seatbelt  on macOS
//   bwrap     on Linux with bubblewrap installed
//   docker    when SWARM_TEST_DOCKER_IMAGE names an image that has bash (for example ubuntu:24.04)
//
// Set SWARM_TEST_TMP to a directory the Docker daemon can mount when the system temp directory
// is not shared with it (Colima shares only the home directory).
//
// Nothing runs when this file is itself inside a sandbox (the project's verify step), because
// OS sandboxes do not nest.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runSandboxed, pickSandbox } from '../src/sandbox.mjs';

const has = (bin) => {
  try {
    execFileSync('/usr/bin/env', ['which', bin], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const nested = Boolean(process.env.SWARM_SANDBOX);
const image = process.env.SWARM_TEST_DOCKER_IMAGE;
const modes = [];
if (!nested && process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec')) modes.push('seatbelt');
if (!nested && process.platform === 'linux' && has('bwrap')) modes.push('bwrap');
if (!nested && image && has('docker')) modes.push('docker');

const base = process.env.SWARM_TEST_TMP || os.tmpdir();
const online = () =>
  new Promise((resolve) => {
    const s = net.connect({ host: '1.1.1.1', port: 443, timeout: 3000 });
    s.on('connect', () => (s.destroy(), resolve(true)));
    s.on('timeout', () => (s.destroy(), resolve(false)));
    s.on('error', () => resolve(false));
  });

test('at least one sandbox is checked outside a sandbox', { skip: nested }, () => {
  if (process.env.SWARM_TEST_REQUIRE_SANDBOX) assert.ok(modes.length > 0, 'no sandbox available to test');
});

for (const mode of modes) {
  test(`${mode}: runs the command, confines writes, hides the home directory, cuts the network, scrubs the environment`, async () => {
    fs.mkdirSync(base, { recursive: true });
    const root = fs.realpathSync(fs.mkdtempSync(path.join(base, `swarm-sbx-test-${mode}-`)));
    const workDir = path.join(root, 'work');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(workDir);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(workDir, 'input.txt'), 'from the host\n');
    const project = { id: 'test', sandbox: { image } };
    const sh = (command, timeoutMs = 60_000) => runSandboxed(command, { workDir, mode, project, timeoutMs });
    process.env.SWARM_TEST_SECRET = 'do-not-leak';
    try {
      // Runs in the work directory, sees its files, and the exit code comes back.
      const seen = await sh('cat input.txt');
      assert.equal(seen.code, 0, seen.stderr);
      assert.equal(seen.stdout.trim(), 'from the host');
      assert.equal(seen.sandbox, mode);
      assert.equal((await sh('exit 7')).code, 7);

      // Writes inside the work directory reach the host.
      const wrote = await sh('echo made-inside > output.txt');
      assert.equal(wrote.code, 0, wrote.stderr);
      assert.equal(fs.readFileSync(path.join(workDir, 'output.txt'), 'utf8').trim(), 'made-inside');

      // Writes outside it do not.
      await sh(`echo escaped > ${JSON.stringify(path.join(outside, 'escaped.txt'))} 2>/dev/null; true`);
      assert.equal(fs.existsSync(path.join(outside, 'escaped.txt')), false, 'a write outside the work directory reached the host');

      // A file in the real home directory cannot be read.
      const home = fs.realpathSync(os.homedir());
      const secret = fs.readdirSync(home).map((n) => path.join(home, n)).find((p) => {
        try {
          return fs.statSync(p).isFile() && fs.statSync(p).size > 0;
        } catch {
          return false;
        }
      });
      if (secret) {
        const read = await sh(`cat ${JSON.stringify(secret)}`);
        assert.notEqual(read.code, 0, `${secret} was readable inside the sandbox`);
        assert.equal(read.stdout, '');
      }

      // The caller's environment does not come along.
      const env = await sh('echo "secret=${SWARM_TEST_SECRET:-unset} flag=${SWARM_SANDBOX:-unset}"');
      assert.equal(env.stdout.trim(), 'secret=unset flag=1');

      // No network. Only meaningful when the host itself is online.
      if (await online()) {
        const dial = await sh("bash -c 'exec 3<>/dev/tcp/1.1.1.1/443' 2>/dev/null && echo CONNECTED || echo blocked", 15_000);
        assert.ok(!dial.stdout.includes('CONNECTED'), 'the sandbox reached the network');
      }
    } finally {
      delete process.env.SWARM_TEST_SECRET;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('auto picks the sandbox for this platform', { skip: nested || process.env.CLAUDE_CODE_REMOTE === 'true' }, async () => {
  if (process.platform === 'darwin') assert.equal(await pickSandbox({}), 'seatbelt');
  else if (process.platform === 'linux' && has('bwrap')) assert.equal(await pickSandbox({}), 'bwrap');
});
