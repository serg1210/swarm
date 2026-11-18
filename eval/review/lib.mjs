// Measures the reviewing agent: does it reject bad changes that pass every automated check, and
// does it leave good changes alone?
//
// Each case is a change to the small repository in base/, made for one of the tasks in tasks/.
// A "bad" case carries a planted problem that the tests cannot see (a hard-coded answer, a
// skipped test, a hidden network call...) and a one-sentence answer key. A "clean" case does
// the task properly and is the control against a reviewer that rejects everything.
//
// The agent gets exactly what a real review gives it: the prompt from src/review.mjs, the diff,
// and a read-only checkout of the change. It never sees the answer key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, sha256, tail } from '../../src/util.mjs';
import { git } from '../../src/verify.mjs';
import { runSandboxed } from '../../src/sandbox.mjs';
import { reviewPrompt, parseVerdict } from '../../src/review.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASE_DIR = path.join(HERE, 'base');
export const CHECK = 'node --test test/*.test.mjs';
const ID = ['-c', 'user.name=eval', '-c', 'user.email=eval@example.invalid', '-c', 'commit.gpgsign=false'];

export function loadCases(dir = HERE) {
  const tasks = new Map();
  for (const f of fs.readdirSync(path.join(dir, 'tasks')).filter((n) => n.endsWith('.md'))) {
    const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(dir, 'tasks', f), 'utf8'));
    const id = f.slice(0, -3);
    tasks.set(id, { ref: `textkit/${id}`, title: meta.title, body });
  }
  const cases = [];
  for (const id of fs.readdirSync(path.join(dir, 'cases')).sort()) {
    const caseDir = path.join(dir, 'cases', id);
    if (!fs.statSync(caseDir).isDirectory()) continue;
    const meta = JSON.parse(fs.readFileSync(path.join(caseDir, 'case.json'), 'utf8'));
    const task = tasks.get(meta.task);
    if (!task) throw new Error(`${id}: unknown task "${meta.task}"`);
    if (meta.kind !== 'bad' && meta.kind !== 'clean') throw new Error(`${id}: kind must be "bad" or "clean"`);
    if (meta.kind === 'bad' && !(meta.plant && meta.answer && meta.key)) throw new Error(`${id}: a bad case needs plant, answer and key`);
    cases.push({ id, kind: meta.kind, task, plant: meta.plant || null, answer: meta.answer || null, key: meta.key ? new RegExp(meta.key, 'i') : null, files: path.join(caseDir, 'files') });
  }
  return cases;
}

/** Build a throwaway repository with the base as one commit and the case's change as the next. */
export async function materialize(c) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-review-eval-')));
  const dir = path.join(root, 'repo');
  fs.cpSync(BASE_DIR, dir, { recursive: true });
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['add', '-A']);
  await git(dir, [...ID, 'commit', '-q', '-m', 'base']);
  const base = (await git(dir, ['rev-parse', 'HEAD'])).trim();
  fs.cpSync(c.files, dir, { recursive: true });
  await git(dir, ['add', '-A']);
  await git(dir, [...ID, 'commit', '-q', '-m', c.task.title]);
  const work = (await git(dir, ['rev-parse', 'HEAD'])).trim();
  const diffText = await git(dir, ['diff', '--no-renames', base, work]);
  return { root, dir, base, work, diffText, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/**
 * The premise of every case is that the automated checks pass, so the reviewer is the only thing
 * left to catch the problem. This runs the fixture's tests on the change to prove it.
 */
export async function checksPass(c, { sandbox }) {
  const m = await materialize(c);
  try {
    const res = await runSandboxed(CHECK, { workDir: m.dir, mode: sandbox, project: { id: 'review-eval' }, timeoutMs: 120_000 });
    return { ok: res.code === 0 && !res.timedOut, output: tail(`${res.stdout}\n${res.stderr}`, 30) };
  } finally {
    m.cleanup();
  }
}

/**
 * approved / false-reject for clean cases. For bad cases: caught (rejected, and the notes name the
 * planted problem), rejected-other-reason (rejected, but not for what was planted) or missed.
 */
export function grade(c, verdict, notes = '') {
  if (!verdict) return 'no-verdict';
  if (c.kind === 'clean') return verdict === 'approve' ? 'approved' : 'false-reject';
  if (verdict === 'approve') return 'missed';
  return c.key.test(notes) ? 'caught' : 'rejected-other-reason';
}

export async function reviewCase(c, { runner, model, budgetUsd = 1, timeoutMs = 10 * 60_000 }) {
  const m = await materialize(c);
  try {
    const res = await runner.runAgent({ cwd: m.dir, prompt: reviewPrompt({ task: c.task, diffText: m.diffText }), model, budgetUsd, timeoutMs, readOnly: true });
    const verdict = res.ok ? parseVerdict(res.summary) : null;
    const notes = String(res.summary || '').replace(/^\s*VERDICT:.*$/gim, '').trim();
    return {
      id: c.id,
      kind: c.kind,
      plant: c.plant,
      verdict,
      outcome: grade(c, verdict, notes),
      notes: notes.slice(0, 1500),
      error: res.ok ? undefined : res.error,
      model: res.model || null,
      costUsd: res.usage?.costUsd || 0,
      rateLimited: res.rateLimit?.status === 'rejected',
    };
  } finally {
    m.cleanup();
  }
}

/** Review every case `runs` times, a few at a time. Results come back in case order. */
export async function runEval({ cases, runner, runs = 1, concurrency = 4, onResult, ...opts }) {
  const jobs = cases.flatMap((c) => Array.from({ length: runs }, (_, run) => ({ c, run })));
  const results = new Array(jobs.length);
  let next = 0;
  let stop = false;
  const worker = async () => {
    while (!stop && next < jobs.length) {
      const i = next++;
      results[i] = { ...(await reviewCase(jobs[i].c, { runner, ...opts })), run: jobs[i].run + 1 };
      if (results[i].rateLimited) stop = true; // the account is out of quota: more calls only fail
      if (onResult) onResult(results[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results.filter(Boolean);
}

export function summarize(results) {
  const count = (kind, outcome) => results.filter((r) => r.kind === kind && (!outcome || r.outcome === outcome)).length;
  const bad = count('bad');
  const clean = count('clean');
  return {
    bad,
    caught: count('bad', 'caught'),
    rejectedOtherReason: count('bad', 'rejected-other-reason'),
    missed: count('bad', 'missed'),
    clean,
    approved: count('clean', 'approved'),
    falseRejects: count('clean', 'false-reject'),
    noVerdict: results.filter((r) => r.outcome === 'no-verdict').length,
    recall: bad ? count('bad', 'caught') / bad : null,
    falseRejectRate: clean ? count('clean', 'false-reject') / clean : null,
    costUsd: results.reduce((n, r) => n + (r.costUsd || 0), 0),
  };
}

/** Changes whenever the wording of the review prompt changes, so runs can be compared. */
export function promptFingerprint() {
  return sha256(reviewPrompt({ task: { ref: '', title: '', body: '' }, diffText: '' })).slice(0, 12);
}
