// Runs verification commands on code an agent just wrote. That code is untrusted, so it runs
// with no network, no view of the user's home directory, a scrubbed environment and write
// access limited to the work directory.
//
//   seatbelt  macOS sandbox-exec (the mechanism Codex and Claude Code use on macOS)
//   bwrap     Linux bubblewrap
//   docker    any platform, when the project names an image
//   cloud-vm  inside a Claude Code cloud session: the session's VM is disposable, holds no
//             credentials (GitHub access is injected by a proxy outside it) and is not the
//             volunteer's machine, so it is the sandbox. Network there follows the cloud
//             environment's allowlist rather than being off.
//   none      refused unless the user passes --unsafe-no-sandbox
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, which, ensureDir } from './util.mjs';

export async function pickSandbox({ requested = 'auto', project } = {}) {
  if (requested !== 'auto') return requested;
  // Checked first: nested OS sandboxes are unreliable inside the cloud VM's container.
  if (process.env.CLAUDE_CODE_REMOTE === 'true') return 'cloud-vm';
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec')) return 'seatbelt';
  let broken = '';
  if (process.platform === 'linux' && (await which('bwrap'))) {
    broken = await bwrapProblem();
    if (!broken) return 'bwrap';
  }
  if (project?.sandbox?.image && (await which('docker'))) return 'docker';
  if (broken) throw new Error(broken);
  throw new Error(
    'No sandbox available. Install bubblewrap (Linux) or Docker, or pass --unsafe-no-sandbox to run verify commands unsandboxed.',
  );
}

let bwrapProbe;
/**
 * Empty when bubblewrap can build a sandbox as this user, otherwise what went wrong and what to
 * do about it. Being installed is not enough: Ubuntu 24.04 and newer stop ordinary users from
 * creating the namespaces it needs.
 */
export function bwrapProblem() {
  bwrapProbe ??= run('bwrap', ['--ro-bind', '/', '/', '--unshare-pid', '--unshare-net', '/bin/sh', '-c', 'true'], { timeoutMs: 10_000 }).then(
    (res) => {
      if (res.code === 0) return '';
      const why = (res.stderr || '').trim().split('\n').pop() || `exit ${res.code}`;
      return [
        `bubblewrap is installed but cannot build a sandbox as this user (${why}).`,
        'On Ubuntu 24.04 and newer, AppArmor stops ordinary users from creating user namespaces. Either allow it',
        'system-wide with `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` (a security setting: your call),',
        'or use Docker instead with `--sandbox docker` for projects that name a sandbox image.',
      ].join(' ');
    },
    (err) => `bubblewrap could not be started: ${err.message}`,
  );
  return bwrapProbe;
}

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

/** Directories under $HOME that hold the toolchain (nvm, volta, mise...) and must stay readable. */
function toolchainDirs(home) {
  const dirs = new Set();
  const nodePrefix = path.dirname(path.dirname(real(process.execPath)));
  if (nodePrefix.startsWith(home + path.sep)) dirs.add(nodePrefix);
  for (const extra of (process.env.SWARM_SANDBOX_READ || '').split(':').filter(Boolean)) dirs.add(real(extra));
  return [...dirs];
}

function ancestors(p) {
  const out = [];
  let cur = path.dirname(p);
  while (cur !== path.dirname(cur)) {
    out.push(cur);
    cur = path.dirname(cur);
  }
  return out;
}

export function seatbeltProfile({ workDir, tmpDir, home, readDirs = [], network = false }) {
  const q = (p) => JSON.stringify(p);
  const readable = [workDir, tmpDir, ...readDirs];
  const meta = [...new Set(readable.flatMap(ancestors).filter((a) => a === home || a.startsWith(home + path.sep)))];
  return [
    '(version 1)',
    '(allow default)',
    network ? '' : '(deny network*)',
    // Loopback only, so tests that start a local server still work. Each direction is spelled
    // out: a bare `(allow network* (local ip "localhost:*"))` also matches outbound connections
    // to any address, which is how this profile used to leak. test/sandbox.test.mjs dials out.
    network ? '' : '(allow network-bind (local ip "localhost:*"))',
    network ? '' : '(allow network-inbound (local ip "localhost:*"))',
    network ? '' : '(allow network-outbound (remote ip "localhost:*"))',
    '(deny file-write*)',
    `(allow file-write* (subpath ${q(workDir)}) (subpath ${q(tmpDir)})`,
    '  (literal "/dev/null") (literal "/dev/tty") (literal "/dev/stdout") (literal "/dev/stderr")',
    '  (literal "/dev/dtracehelper") (regex #"^/dev/fd/"))',
    `(deny file-read* (subpath ${q(home)}))`,
    `(allow file-read* ${readable.map((d) => `(subpath ${q(d)})`).join(' ')})`,
    meta.length ? `(allow file-read-metadata ${meta.map((d) => `(literal ${q(d)})`).join(' ')})` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function scrubbedEnv({ tmpDir, fakeHome }) {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: fakeHome,
    TMPDIR: tmpDir,
    LANG: process.env.LANG || 'en_US.UTF-8',
    CI: '1',
    NO_COLOR: '1',
    SWARM_SANDBOX: '1',
  };
}

/**
 * Run `command` (a shell string from the project manifest) inside the sandbox.
 * Returns { code, stdout, stderr, timedOut, sandbox }.
 */
export async function runSandboxed(command, { workDir, mode, project, timeoutMs = 300_000 }) {
  workDir = real(workDir);
  const tmpDir = real(ensureDir(path.join(os.tmpdir(), `swarm-sbx-${process.pid}-${Date.now()}`)));
  const fakeHome = ensureDir(path.join(tmpDir, 'home'));
  const env = scrubbedEnv({ tmpDir, fakeHome });
  const network = Boolean(project?.sandbox?.network);
  try {
    let res;
    if (mode === 'seatbelt') {
      const home = real(os.homedir());
      const profile = seatbeltProfile({ workDir, tmpDir, home, readDirs: toolchainDirs(home), network });
      res = await run('/usr/bin/sandbox-exec', ['-p', profile, '/bin/sh', '-c', command], { cwd: workDir, env, timeoutMs });
    } else if (mode === 'bwrap') {
      const home = real(os.homedir());
      const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', home];
      for (const d of toolchainDirs(home)) args.push('--ro-bind', d, d);
      args.push('--bind', tmpDir, tmpDir, '--bind', workDir, workDir, '--chdir', workDir);
      args.push('--unshare-pid', '--die-with-parent', '--new-session');
      if (!network) args.push('--unshare-net');
      res = await run('bwrap', [...args, '/bin/sh', '-c', command], { cwd: workDir, env, timeoutMs });
    } else if (mode === 'docker') {
      const image = project?.sandbox?.image;
      if (!image) throw new Error(`Project ${project?.id} has no sandbox.image; docker sandbox needs one`);
      const args = ['run', '--rm', '--network', network ? 'bridge' : 'none', '--cap-drop', 'ALL'];
      args.push('--security-opt', 'no-new-privileges', '--pids-limit', '512', '--memory', '4g');
      args.push('-v', `${workDir}:/work`, '-w', '/work', '-e', 'CI=1', '-e', 'NO_COLOR=1', '-e', 'HOME=/tmp', '-e', 'SWARM_SANDBOX=1');
      if (typeof process.getuid === 'function') args.push('--user', `${process.getuid()}:${process.getgid()}`);
      res = await run('docker', [...args, image, '/bin/sh', '-c', command], { timeoutMs });
    } else if (mode === 'none' || mode === 'cloud-vm') {
      res = await run('/bin/sh', ['-c', command], { cwd: workDir, env, timeoutMs });
    } else {
      throw new Error(`Unknown sandbox mode: ${mode}`);
    }
    return { ...res, sandbox: mode };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
