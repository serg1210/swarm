// Verified work that could not be submitted yet.
//
// Submitting needs GitHub, and GitHub can be out of reach for a moment after the work is done:
// the network drops, a login lapses, the service is down. The change is already verified and
// signed by then, so it is kept here with its work directory and submitted at the start of the
// next run, before anything new is started. The volunteer is never asked to push it by hand.
import fs from 'node:fs';
import path from 'node:path';
import { SWARM_HOME, ensureDir, readJson, writeJson, ok, warn } from './util.mjs';
import { findTask, completedTasks } from './project.mjs';
import { openRepo } from './open.mjs';
import { record } from './worker.mjs';

const MAX_AGE_MS = 7 * 24 * 3_600_000;
const dir = () => path.join(SWARM_HOME, 'outbox');
const fileOf = (id) => path.join(dir(), `${id}.json`);
const firstLine = (err) => String(err?.message || err).trim().split('\n')[0].slice(0, 200);

/** Keep a verified, signed change for a later submit. Returns the stored entry. */
export function hold({ repoSpec, taskRef, workDir, branch, claim, receipt, summary, approvalsNeeded, runner, usage, error }) {
  const entry = {
    id: `${taskRef.replace('/', '-')}-${Date.now().toString(36)}`,
    repoSpec,
    taskRef,
    workDir,
    branch,
    claim,
    receipt,
    summary,
    approvalsNeeded,
    runner,
    usage,
    heldAt: new Date().toISOString(),
    tries: 0,
    lastError: firstLine(error),
  };
  ensureDir(dir());
  writeJson(fileOf(entry.id), entry);
  return entry;
}

export function held() {
  if (!fs.existsSync(dir())) return [];
  return fs
    .readdirSync(dir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(dir(), f), null))
    .filter(Boolean);
}

function drop(entry, { removeWork = true } = {}) {
  fs.rmSync(fileOf(entry.id), { force: true });
  if (removeWork && entry.workDir) fs.rmSync(entry.workDir, { recursive: true, force: true });
}

/**
 * Try to submit everything that is waiting. Never throws: a failure leaves the entry for the
 * next run. Work is dropped when it can no longer be used: its task is finished or gone, enough
 * other workers submitted in the meantime, its directory is missing, or it is a week old.
 * Returns { submitted: [{ task, where }], waiting, dropped }.
 */
export async function flushOutbox({ identity, now = Date.now() } = {}) {
  const out = { submitted: [], waiting: 0, dropped: 0 };
  for (const entry of held()) {
    try {
      if (!fs.existsSync(entry.workDir) || now - new Date(entry.heldAt).getTime() > MAX_AGE_MS) {
        drop(entry);
        out.dropped++;
        continue;
      }
      const { repo, mirror, board } = await openRepo(entry.repoSpec, identity);
      const found = findTask(mirror.projects, entry.taskRef);
      const finished = found && completedTasks(mirror.dir, found.project.id).has(found.task.id);
      const others = found ? ((await board.claims(mirror.projects)).get(entry.taskRef) || []).filter((c) => c.submitted) : [];
      const mine = others.find((c) => String(identity.id).startsWith(String(c.worker).slice(0, 8)));
      if (mine) {
        // The push went through last time and only the answer was lost.
        record({ repo: repo.slug, task: entry.taskRef, status: 'submitted', usage: entry.usage, runner: entry.runner });
        drop(entry);
        out.submitted.push({ task: entry.taskRef, where: mine.number ? `#${mine.number}` : entry.branch });
        continue;
      }
      if (!found || finished || others.length >= found.project.replication) {
        drop(entry);
        out.dropped++;
        continue;
      }
      const access = await board.access({ prepare: true });
      if (!access.ok) throw new Error(access.reason);
      const sub = await board.submit({ workDir: entry.workDir, branch: entry.branch, claim: entry.claim, project: found.project, task: found.task, receipt: entry.receipt, summary: entry.summary, approvalsNeeded: entry.approvalsNeeded });
      record({ repo: repo.slug, task: entry.taskRef, status: 'submitted', usage: entry.usage, runner: entry.runner, where: sub.where });
      ok(`Submitted earlier work ${entry.taskRef} → ${sub.where}`);
      drop(entry);
      out.submitted.push({ task: entry.taskRef, where: sub.where });
    } catch (err) {
      writeJson(fileOf(entry.id), { ...entry, tries: (entry.tries || 0) + 1, lastError: firstLine(err) });
      warn(`Earlier work on ${entry.taskRef} is still waiting to be submitted: ${firstLine(err)}`);
      out.waiting++;
    }
  }
  return out;
}
