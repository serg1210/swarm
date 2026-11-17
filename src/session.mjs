// Connector sessions: the "bring your own agent" path.
//
// When Swarm is installed as an MCP connector, the host agent (Claude in Cowork, Hermes, Codex,
// anything that speaks MCP) can do the task itself instead of Swarm starting a CLI. The host
// gets no path on disk to wander around in. It gets a session, and file tools that reach only
// that session's fresh clone and only the paths the task allows. Swarm still does the claiming,
// the policy check, the sandboxed verification, the signing and the pull request.
//
// A session is a JSON file under ~/.swarm/sessions, so it survives a restart of the connector.
import fs from 'node:fs';
import path from 'node:path';
import { SWARM_HOME, ensureDir, readJson, writeJson, run, matchesAny } from './util.mjs';
import { findTask, protectedGlobs, verifySteps } from './project.mjs';
import { git, diffSummary, checkPolicy, runVerify, describeFailure } from './verify.mjs';
import { pickSandbox } from './sandbox.mjs';
import { makeWorkDir } from './repo.mjs';
import { openRepo } from './open.mjs';
import { requiredQuorum } from './quorum.mjs';
import { buildPrompt, openTasks, sealWork, record } from './worker.mjs';

export const MAX_FINISH_ATTEMPTS = 3;
const MAX_READ_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;

const dir = () => path.join(SWARM_HOME, 'sessions');
const fileOf = (id) => path.join(dir(), `${id}.json`);

export function loadSession(id) {
  if (!/^[a-z0-9-]+$/.test(String(id))) throw new Error('Invalid session id.');
  const s = readJson(fileOf(id), null);
  if (!s) throw new Error(`No session "${id}". Call swarm_begin first.`);
  return s;
}

const save = (s) => writeJson(fileOf(s.id), s);

export function activeSession() {
  if (!fs.existsSync(dir())) return null;
  for (const f of fs.readdirSync(dir()).filter((x) => x.endsWith('.json'))) {
    const s = readJson(path.join(dir(), f), null);
    if (s?.status === 'active' && new Date(s.expiresAt) > new Date() && fs.existsSync(s.workDir)) return s;
  }
  return null;
}

async function sandboxMode(project) {
  return pickSandbox({ requested: process.env.SWARM_UNSAFE_NO_SANDBOX ? 'none' : process.env.SWARM_SANDBOX_MODE || 'auto', project });
}

function describe(session, project, task, hints) {
  return {
    session: session.id,
    task: task.ref,
    title: task.title,
    repository: session.repoSpec,
    expiresAt: session.expiresAt,
    allowedPaths: task.paths,
    verifySteps: verifySteps(project, task).map((s) => ({ name: s.name, run: s.run })),
    attemptsLeft: MAX_FINISH_ATTEMPTS - session.attempts,
    // Shell mode hands out the directory; connector mode never does, its file tools are the only way in.
    ...(session.mode === 'shell' ? { workDir: session.workDir } : {}),
    instructions: buildPrompt({ project, task, hints, mode: session.mode || 'connector', workDir: session.workDir, session: session.id }),
  };
}

/** Claim a task and prepare its clone. One session at a time; an unfinished one is resumed. */
export async function beginSession({ identity, targets, taskRef, agent, model, mode = 'connector' }) {
  const existing = activeSession();
  if (existing) {
    const { mirror } = await openRepo(existing.repoSpec, identity, { at: existing });
    const found = findTask(mirror.projects, existing.taskRef);
    return { resumed: true, ...describe(existing, found.project, found.task) };
  }
  // Fail before claiming anything if this machine cannot verify.
  await sandboxMode();
  for (const target of targets) {
    const { repo, mirror, board } = await openRepo(target.repo, identity);
    const claims = await board.claims(mirror.projects);
    const open = openTasks(mirror.projects, mirror.dir, claims, { projectId: target.project, taskRef, unpublished: board.unpublished }).filter((r) => r.state === 'open');
    if (!open.length) continue;
    const pick = open[Math.floor(Math.random() * open.length)];
    const branch = board.branchFor(pick.task);
    const workDir = await makeWorkDir(repo, mirror, { name: `${pick.project.id}-${pick.task.id}`, commit: mirror.base, branch });
    const claim = await board.claim({ project: pick.project, task: pick.task, workDir, branch, base: mirror.base });
    if (!claim) {
      fs.rmSync(workDir, { recursive: true, force: true });
      continue;
    }
    const session = {
      id: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      status: 'active',
      mode,
      repoSpec: target.repo,
      taskRef: pick.task.ref,
      base: mirror.base,
      branch: mirror.branch,
      workBranch: branch,
      workDir,
      claim,
      attempts: 0,
      agent: { runner: `${mode}:${String(agent || 'unknown').slice(0, 40)}`, model: String(model || 'unreported').slice(0, 80), selfReported: true },
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + pick.project.claimTtlMinutes * 60_000).toISOString(),
    };
    ensureDir(dir());
    save(session);
    return describe(session, pick.project, pick.task, board.hints?.(pick.task.ref));
  }
  return { session: null, message: taskRef ? `Task ${taskRef} is not open.` : 'No open tasks in the projects you chose right now.' };
}

async function reopen(session, identity) {
  const ctx = await openRepo(session.repoSpec, identity, { at: session });
  const found = findTask(ctx.mirror.projects, session.taskRef);
  if (!found) throw new Error(`Task ${session.taskRef} no longer exists at the session's base commit.`);
  return { ...ctx, ...found };
}

async function close(session, ctx, status, { failedStep, result }) {
  session.status = status;
  session.result = result;
  session.endedAt = new Date().toISOString();
  save(session);
  if (status !== 'submitted') await ctx.board.release(session.claim, { failedStep }).catch(() => {});
  record({ repo: ctx.repo.slug, task: session.taskRef, status, usage: { costUsd: 0 }, runner: session.agent.runner, where: result?.where });
  if (status === 'submitted') fs.rmSync(session.workDir, { recursive: true, force: true });
  return result;
}

/**
 * Check the policy, verify in the sandbox, sign and submit. On failure the session stays open
 * and the caller gets the verifier's output, until the attempts run out.
 * Calling it again after it finished returns the stored outcome instead of repeating the work.
 */
export async function finishSession(id, { identity, summary }) {
  const session = loadSession(id);
  if (session.status !== 'active') return session.result;
  const ctx = await reopen(session, identity);
  const { project, task, mirror, board } = ctx;
  if (new Date(session.expiresAt) < new Date()) {
    return close(session, ctx, 'failed', { result: { ok: false, final: true, problem: 'The claim on this task lapsed before the work was finished. Nothing was submitted.' } });
  }

  const fail = async (failedStep, feedback) => {
    session.attempts += 1;
    const left = MAX_FINISH_ATTEMPTS - session.attempts;
    if (left <= 0) {
      return close(session, ctx, 'failed', { failedStep, result: { ok: false, final: true, failedStep, problem: `${feedback}\n\nNo attempts left. The task was released and nothing was submitted.` } });
    }
    save(session);
    return { ok: false, final: false, failedStep, attemptsLeft: left, problem: feedback };
  };

  await git(session.workDir, ['add', '-A']);
  const diff = await diffSummary(session.workDir, mirror.base);
  const problems = checkPolicy(diff, project, task);
  if (problems.length) return fail('policy', `The change breaks the contribution policy:\n${problems.map((p) => `- ${p}`).join('\n')}`);

  const sandbox = await sandboxMode(project);
  const verify = await runVerify(project, task, { workDir: session.workDir, sandbox });
  if (!verify.ok) return fail(verify.results.at(-1).name, describeFailure(verify));

  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0, durationMs: Date.now() - new Date(session.startedAt).getTime() };
  const receipt = await sealWork({ workDir: session.workDir, project, task, base: mirror.base, diff, agent: session.agent, usage, verify, sandbox, attempts: session.attempts + 1, identity });
  const sub = await board.submit({ workDir: session.workDir, branch: session.workBranch, claim: session.claim, project, task, receipt, summary: String(summary || '').slice(0, 6000), approvalsNeeded: requiredQuorum(project, diff.files.map((f) => f.file)) });
  return close(session, ctx, 'submitted', {
    result: { ok: true, final: true, task: task.ref, where: sub.where, verified: verify.results.map((r) => r.name), filesChanged: diff.files.length, linesChanged: diff.lines, sandbox },
  });
}

export async function abandonSession(id, { identity, reason }) {
  const session = loadSession(id);
  if (session.status !== 'active') return session.result;
  const ctx = await reopen(session, identity);
  return close(session, ctx, 'abandoned', { failedStep: 'agent', result: { ok: false, final: true, problem: `Abandoned: ${String(reason || 'no reason given').slice(0, 300)}` } });
}

// ---- File tools, confined to the session's clone ----------------------------------------------

function activeById(id) {
  const session = loadSession(id);
  if (session.status !== 'active') throw new Error(`Session ${id} is ${session.status}; start a new one with swarm_begin.`);
  return session;
}

/** Resolve a repository-relative path, refusing anything that leaves the clone or enters .git. */
export function resolveInside(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) throw new Error('A repository-relative path is required.');
  if (path.isAbsolute(rel)) throw new Error('Use a path relative to the repository root.');
  const clean = path.posix.normalize(rel.replaceAll('\\', '/'));
  if (clean === '..' || clean.startsWith('../')) throw new Error('The path leaves the repository.');
  if (clean.split('/').includes('.git')) throw new Error('.git is not accessible.');
  const realRoot = fs.realpathSync(root);
  // Walk up to the nearest existing ancestor and make sure symlinks did not take us outside.
  let probe = path.join(realRoot, clean);
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const real = fs.realpathSync(probe);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error('The path leaves the repository.');
  return { abs: path.join(realRoot, clean), rel: clean === '.' ? '' : clean };
}

async function writable(session, identity, rel) {
  const { project, task } = await reopen(session, identity);
  if (matchesAny(rel, protectedGlobs(project))) throw new Error(`${rel} is protected and cannot be changed by a contribution.`);
  if (!matchesAny(rel, task.paths)) throw new Error(`${rel} is outside the paths this task may touch (${task.paths.join(', ')}).`);
}

export async function listFiles(id, prefix = '') {
  const session = activeById(id);
  const { rel } = resolveInside(session.workDir, prefix || '.');
  const out = await git(session.workDir, ['ls-files', '-co', '--exclude-standard', '--', rel || '.']);
  const files = out.split('\n').filter(Boolean);
  return { files: files.slice(0, 2000), truncated: files.length > 2000 };
}

export function readFile(id, rel, { offset = 0, limit = 2000 } = {}) {
  const session = activeById(id);
  const { abs } = resolveInside(session.workDir, rel);
  const st = fs.lstatSync(abs);
  if (!st.isFile()) throw new Error(`${rel} is not a regular file.`);
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  let text = lines.slice(offset, offset + limit).join('\n');
  const truncated = offset + limit < lines.length || text.length > MAX_READ_BYTES;
  if (text.length > MAX_READ_BYTES) text = text.slice(0, MAX_READ_BYTES);
  return { path: rel, totalLines: lines.length, offset, truncated, text };
}

export async function searchFiles(id, pattern, { prefix = '', regex = false } = {}) {
  const session = activeById(id);
  if (typeof pattern !== 'string' || !pattern) throw new Error('A search pattern is required.');
  const { rel } = resolveInside(session.workDir, prefix || '.');
  const res = await run('git', ['grep', '-n', '-I', '--untracked', regex ? '-E' : '-F', '-e', pattern, '--', rel || '.'], { cwd: session.workDir });
  const matches = res.stdout.split('\n').filter(Boolean);
  return { matches: matches.slice(0, 200).map((m) => m.slice(0, 400)), truncated: matches.length > 200 };
}

export async function writeFile(id, rel, content, { identity }) {
  const session = activeById(id);
  if (typeof content !== 'string') throw new Error('content must be a string.');
  if (Buffer.byteLength(content) > MAX_WRITE_BYTES) throw new Error('File too large (limit 1 MB).');
  const { abs, rel: clean } = resolveInside(session.workDir, rel);
  await writable(session, identity, clean);
  if (fs.existsSync(abs) && !fs.lstatSync(abs).isFile()) throw new Error(`${rel} exists and is not a regular file.`);
  ensureDir(path.dirname(abs));
  resolveInside(session.workDir, clean); // re-check now that parent directories exist
  fs.writeFileSync(abs, content);
  return { path: clean, bytes: Buffer.byteLength(content) };
}

export async function editFile(id, rel, oldText, newText, { identity, replaceAll = false }) {
  const session = activeById(id);
  const { abs, rel: clean } = resolveInside(session.workDir, rel);
  await writable(session, identity, clean);
  if (!fs.existsSync(abs) || !fs.lstatSync(abs).isFile()) throw new Error(`${rel} does not exist. Use swarm_write to create it.`);
  if (typeof oldText !== 'string' || !oldText) throw new Error('old_text must be a non-empty string.');
  const text = fs.readFileSync(abs, 'utf8');
  const count = text.split(oldText).length - 1;
  if (count === 0) throw new Error('old_text was not found in the file. Read the file again and copy the text exactly.');
  if (count > 1 && !replaceAll) throw new Error(`old_text appears ${count} times. Include more surrounding text, or set replace_all.`);
  const next = replaceAll ? text.split(oldText).join(newText) : text.replace(oldText, () => newText);
  if (Buffer.byteLength(next) > MAX_WRITE_BYTES) throw new Error('File too large (limit 1 MB).');
  fs.writeFileSync(abs, next);
  return { path: clean, replacements: replaceAll ? count : 1 };
}

export async function deleteFile(id, rel, { identity }) {
  const session = activeById(id);
  const { abs, rel: clean } = resolveInside(session.workDir, rel);
  await writable(session, identity, clean);
  if (!fs.existsSync(abs) || !fs.lstatSync(abs).isFile()) throw new Error(`${rel} is not a file.`);
  fs.rmSync(abs);
  return { path: clean, deleted: true };
}
