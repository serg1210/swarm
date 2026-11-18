// What a volunteer should see before any quota is spent: how much is left, what Swarm will do
// with it, and which other projects they could point it at. Built as plain data so every host
// can show it its own way: a card where the app can draw one, a few lines of text elsewhere.
// The wording is deliberately blunt: numbers first, seven words a line at most, nothing to skim
// past. `steps` is the run as a checklist; jobProgress() says which step a running job is on.
import { fmtDuration } from './util.mjs';

const SIZE_WORD = { S: 'small', M: 'medium', L: 'large' };
const SIZE_ORDER = { S: 0, M: 1, L: 2 };
const pct = (n) => Math.round(n * 100);
const short = (text, max) => (text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…');
/** A task title cut to its first few words, for one line of a checklist. */
export function shortTitle(title, words = 5) {
  const all = String(title).replace(/`/g, '').trim().split(/\s+/);
  return all.length <= words ? all.join(' ') : all.slice(0, words).join(' ') + '…';
}

function windowView(w, reservePct, now) {
  if (!w || w.utilization == null) return null;
  const usedPct = Math.min(100, Math.max(0, pct(w.utilization)));
  const leftPct = 100 - usedPct;
  return {
    usedPct,
    leftPct,
    swarmCanUsePct: Math.max(0, leftPct - reservePct),
    resetsAt: w.resetsAt || null,
    resetsIn: w.resetsAt ? fmtDuration(Math.max(0, new Date(w.resetsAt) - now)) : null,
  };
}

function quotaView({ rateLimit, decision, reserve, cloud, now }) {
  const reservePct = pct(reserve);
  const weekly = windowView(rateLimit?.weekly, reservePct, now);
  const fiveHour = windowView(rateLimit?.fiveHour, reservePct, now);
  if (!weekly && !fiveHour) {
    return {
      known: false,
      reservePct,
      go: decision?.go ?? true,
      headline: cloud ? 'Quota unknown in the cloud.' : 'Quota unknown here. No reserve kept.',
      line: 'Contributing quota, amount unknown here',
    };
  }
  const main = weekly || fiveHour;
  const label = weekly ? 'this week' : 'in this 5-hour window';
  const go = decision?.go ?? true;
  const headline = go ? `${main.leftPct}% left ${label}. Swarm uses ${main.swarmCanUsePct}%.` : `Reserve reached: ${main.usedPct}% used. Nothing spent.`;
  // The leftover that lapses first is the one worth naming: its size and when it expires.
  const soonest = [fiveHour, weekly].filter((w) => w?.resetsAt).sort((a, b) => new Date(a.resetsAt) - new Date(b.resetsAt))[0] || main;
  // When the reserve stops a run, name the window that reached it, not the one with room left.
  const full = [fiveHour, weekly].find((w) => w && w.leftPct <= reservePct) || main;
  const line = !go
    ? `Quota: ${full.usedPct}% used, reserve reached`
    : soonest.resetsIn
      ? `Contributing ${soonest.swarmCanUsePct}% quota, expires in ${soonest.resetsIn}`
      : `Contributing ${soonest.swarmCanUsePct}% of leftover quota`;
  return { known: true, reservePct, go, reason: decision?.reason || null, weekly, fiveHour, headline, line };
}

/**
 * registry:   [{ repo, project, name, description, languages }]   projects that opted in
 * chosen:     ['owner/repo#project' | 'owner/repo']               what the user picked
 * tasksByRepo: { [repo]: [{ project, projectName, projectDescription, ref, title, size, state }] | { error } }
 * access:     { [repo]: { ok, reason } }   whether a finished task could be submitted from here
 * waiting:    how many finished tasks from earlier runs still wait to be submitted
 */
export function buildBriefing({ rateLimit = null, decision = null, reserve = 0.2, cloud = false, registry = [], chosen = [], usingDefault = false, tasksByRepo = {}, activity = {}, access = {}, waiting = 0, now = new Date() }) {
  const quota = quotaView({ rateLimit, decision, reserve, cloud, now });

  const isChosen = (repo, project) => chosen.some((c) => c === repo || c === `${repo}#${project}`);
  const byId = new Map();
  const add = (repo, project, info = {}) => {
    const id = `${repo}#${project}`;
    const prev = byId.get(id) || {};
    byId.set(id, { id, repo, project, name: info.name || prev.name || project, description: info.description || prev.description || '', languages: info.languages || prev.languages || [] });
  };
  for (const p of registry) add(p.repo, p.project, p);
  for (const [repo, rows] of Object.entries(tasksByRepo)) {
    if (!Array.isArray(rows)) continue;
    for (const r of rows) if (!byId.has(`${repo}#${r.project}`)) add(repo, r.project, { name: r.projectName, description: r.projectDescription });
  }

  const projects = [...byId.values()].map((p) => {
    const rows = tasksByRepo[p.repo];
    const reachable = Array.isArray(rows);
    const open = reachable
      ? rows.filter((r) => r.project === p.project && r.state === 'open').sort((a, b) => (SIZE_ORDER[a.size] ?? 9) - (SIZE_ORDER[b.size] ?? 9) || a.ref.localeCompare(b.ref))
      : [];
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      languages: p.languages,
      url: /^[\w.-]+\/[\w.-]+$/.test(p.repo) ? `https://github.com/${p.repo}` : null,
      chosen: isChosen(p.repo, p.project),
      openTasks: reachable ? open.length : null,
      examples: open.slice(0, 3).map((r) => r.title),
      unreachable: reachable ? undefined : rows?.error || 'not checked',
      // False only when asked and refused: work done for this project could not be submitted from here.
      canSubmit: access[p.repo]?.ok !== false,
      cannotSubmitReason: access[p.repo]?.ok === false ? access[p.repo].reason : undefined,
      _open: open,
    };
  });
  projects.sort((a, b) => Number(b.chosen) - Number(a.chosen) || (b.openTasks ?? -1) - (a.openTasks ?? -1) || a.name.localeCompare(b.name));

  const mine = projects.filter((p) => p.chosen);
  // A project counts only if what is done for it can be submitted: nobody's quota goes into a
  // task that would have nowhere to go.
  const withWork = mine.find((p) => p._open.length && p.canSubmit);
  const stuck = withWork ? null : mine.find((p) => p._open.length && !p.canSubmit) || (mine.length && mine.every((p) => p.unreachable) ? mine[0] : null);
  const blocked = stuck ? { project: stuck.id, reason: stuck.cannotSubmitReason || `the project could not be reached (${stuck.unreachable})` } : null;
  const next = withWork
    ? { project: withWork.id, projectName: withWork.name, task: withWork._open[0].ref, title: withWork._open[0].title, size: withWork._open[0].size, sizeWord: SIZE_WORD[withWork._open[0].size] || 'unsized' }
    : null;
  const elsewhere = projects.find((p) => !p.chosen && p.openTasks && p.canSubmit);
  const suggestion = !next && !blocked && elsewhere ? { project: elsewhere.id, name: elsewhere.name, reason: `Nothing open in your project${mine.length === 1 ? '' : 's'}. ${elsewhere.name} has ${elsewhere.openTasks}.` } : null;

  const plan = !quota.go ? 'Nothing spent.' : blocked ? 'Cannot submit from here. Nothing spent.' : next ? `${next.projectName}: ${shortTitle(next.title)}` : suggestion ? suggestion.reason : 'Nothing open. Nothing spent.';

  // Other agents on the same project right now: finishing = work submitted and waiting for a
  // review, working = a live claim with nothing submitted yet. Real counts, or it says so.
  const focus = withWork || mine[0] || null;
  const seen = focus ? activity[`${focus.id}`] || { finishing: 0, working: 0 } : { finishing: 0, working: 0 };
  const agents = (n) => `${n} agent${n === 1 ? '' : 's'}`;
  const crowd =
    seen.finishing && seen.working
      ? `${agents(seen.finishing)} finishing, ${seen.working} working`
      : seen.finishing
        ? `${agents(seen.finishing)} about to finish`
        : seen.working
          ? `${agents(seen.working)} working right now`
          : 'No agents here yet, you start';
  const openHere = withWork ? withWork._open.length : 0;
  const boost = withWork ? `Accelerating ${shortTitle(withWork.name, 2)}: 1 of ${openHere} task${openHere === 1 ? '' : 's'}` : null;

  // The run as a checklist: one short line per step, in the order they happen.
  const willRun = Boolean(quota.go && next);
  const steps = !quota.go
    ? [crowd, quota.line, 'Nothing spent']
    : blocked
      ? ['Cannot submit from here', 'No task started, nothing spent']
      : !next
        ? [crowd, quota.line, 'Nothing open, nothing spent']
        : [crowd, quota.line, boost, `Claim task: ${shortTitle(next.title)}`, 'Agent writes the change', 'Checks run in sandbox', 'Pull request opens'];

  const choice = (p) => ({
    id: p.id,
    label: short(p.name, 28),
    description: short(
      [p.description, p.openTasks == null ? 'Unreachable right now.' : `${p.openTasks} open.${p.examples[0] ? ` E.g. "${p.examples[0]}".` : ''}`].filter(Boolean).join(' '),
      220,
    ),
    current: p.chosen,
  });

  const others = projects.filter((p) => !p.chosen && p.openTasks && p.canSubmit);
  const text = [...steps];
  if (others.length) text.push(`Also open: ${short(others[0].name, 28)} (${others[0].openTasks})${others.length > 1 ? `, +${others.length - 1}` : ''}`);

  return {
    quota,
    plan,
    willRun,
    // Set when the chosen project has work but this session could not submit it. The run must
    // not start, by any route; `reason` is for one line of report, not for the user to act on.
    blocked,
    waiting,
    agents: seen,
    steps,
    next,
    suggestion,
    usingDefault,
    projects: projects.map(({ _open, ...p }) => p),
    choices: projects.map(choice),
    text,
  };
}

const STAGES = [
  [/Submitted /, 7, 'Pull request opened', true],
  [/Dry run: nothing pushed/, 7, 'Dry run done, nothing pushed', true],
  [/Verified:/, 7, 'Opening pull request'],
  [/^›\s{2,}([\w.-]+): /, 6, (m) => `Running check: ${m[1]}`],
  [/Verifying in (\w+) sandbox/, 6, 'Running checks in sandbox'],
  [/Agent (\w+) working \(attempt (\d+)/, 5, (m) => `Agent ${m[1]} writing, attempt ${m[2]}`],
  [/Claiming (\S+?):/, 4, (m) => `Claiming ${m[1]}`],
  [/Work kept:/, 7, 'Kept, goes out next run', true],
  [/Cannot submit from here/, 2, 'Cannot submit from here, nothing spent', true],
  [/Not donating now/, 2, 'Reserve reached, nothing spent', true],
  [/Checking your quota/, 2, 'Checking quota'],
  [/Syncing /, 1, 'Syncing the project'],
];

/**
 * Where a `swarm run` job is, read from its log: the checklist step it is on (1-based, matching
 * `steps` in the briefing), what it is doing right now in a few words, and whether it has ended.
 */
export function jobProgress(log) {
  const lines = String(log || '').split('\n').filter((l) => l.trim());
  const claimed = lines.findLastIndex((l) => /Claiming /.test(l));
  const failed = lines.slice(Math.max(claimed, 0)).findLast((l) => /^\s*✗ /.test(l))?.replace(/^\s*✗\s*/, '') || null;
  // A run reviews someone else's submission before claiming; its check lines are not this task's.
  const reviewing = lines.findLastIndex((l) => /Reviewing \S+ from worker/.test(l));
  if (reviewing > Math.max(claimed, lines.findLastIndex((l) => /Session\W/.test(l)))) {
    return { step: 3, now: `Reviewing ${/Reviewing (\S+)/.exec(lines[reviewing])[1]} for another agent`, done: false };
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    for (const [re, step, now, done] of STAGES) {
      const m = re.exec(line);
      if (!m) continue;
      const out = { step, now: typeof now === 'function' ? now(m) : now, done: Boolean(done) };
      const url = step === 7 && done ? /https?:\/\/\S+/.exec(line) : null;
      if (url) out.pullRequest = url[0];
      // A failed check is news while the agent gets another attempt, and stale once checks pass.
      if (failed && !done && step < 7) out.problem = shortTitle(failed, 7);
      return out;
    }
  }
  return { step: 0, now: 'Starting', done: false };
}

/**
 * The one line under the checklist. It swaps on every poll: what the job is doing when that has
 * changed since the last look, otherwise how long it has been going, so the line never sits still.
 */
export function statusLine(progress, { elapsedMs = 0, previous = null } = {}) {
  if (progress.done || progress.now !== previous?.now || previous?.showedElapsed) return { text: progress.now, showedElapsed: false };
  return { text: `Still at it, ${fmtDuration(elapsedMs)} in`, showedElapsed: true };
}
