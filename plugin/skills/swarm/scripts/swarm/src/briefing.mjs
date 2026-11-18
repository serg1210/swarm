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
      line: 'Quota: unknown here',
    };
  }
  const main = weekly || fiveHour;
  const label = weekly ? 'this week' : 'in this 5-hour window';
  const go = decision?.go ?? true;
  const headline = go ? `${main.leftPct}% left ${label}. Swarm uses ${main.swarmCanUsePct}%.` : `Reserve reached: ${main.usedPct}% used. Nothing spent.`;
  const line = go ? `Quota: ${main.leftPct}% left, Swarm uses ${main.swarmCanUsePct}%` : `Quota: ${main.usedPct}% used, reserve reached`;
  return { known: true, reservePct, go, reason: decision?.reason || null, weekly, fiveHour, headline, line };
}

/**
 * registry:   [{ repo, project, name, description, languages }]   projects that opted in
 * chosen:     ['owner/repo#project' | 'owner/repo']               what the user picked
 * tasksByRepo: { [repo]: [{ project, projectName, projectDescription, ref, title, size, state }] | { error } }
 */
export function buildBriefing({ rateLimit = null, decision = null, reserve = 0.2, cloud = false, registry = [], chosen = [], usingDefault = false, tasksByRepo = {}, now = new Date() }) {
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
      _open: open,
    };
  });
  projects.sort((a, b) => Number(b.chosen) - Number(a.chosen) || (b.openTasks ?? -1) - (a.openTasks ?? -1) || a.name.localeCompare(b.name));

  const mine = projects.filter((p) => p.chosen);
  const withWork = mine.find((p) => p._open.length);
  const next = withWork
    ? { project: withWork.id, projectName: withWork.name, task: withWork._open[0].ref, title: withWork._open[0].title, size: withWork._open[0].size, sizeWord: SIZE_WORD[withWork._open[0].size] || 'unsized' }
    : null;
  const elsewhere = projects.find((p) => !p.chosen && p.openTasks);
  const suggestion = !next && elsewhere ? { project: elsewhere.id, name: elsewhere.name, reason: `Nothing open in your project${mine.length === 1 ? '' : 's'}. ${elsewhere.name} has ${elsewhere.openTasks}.` } : null;

  const plan = !quota.go ? 'Nothing spent.' : next ? `${next.projectName}: ${shortTitle(next.title)}` : suggestion ? suggestion.reason : 'Nothing open. Nothing spent.';

  // The run as a checklist: one short line per step, in the order they happen.
  const steps = !quota.go
    ? [quota.line, 'Nothing spent']
    : !next
      ? [quota.line, 'Nothing open, nothing spent']
      : [quota.line, `Project: ${short(next.projectName, 32)}`, `Claim task: ${shortTitle(next.title)}`, 'Agent writes the change', 'Checks run in sandbox', 'Pull request opens'];

  const choice = (p) => ({
    id: p.id,
    label: short(p.name, 28),
    description: short(
      [p.description, p.openTasks == null ? 'Unreachable right now.' : `${p.openTasks} open.${p.examples[0] ? ` E.g. "${p.examples[0]}".` : ''}`].filter(Boolean).join(' '),
      220,
    ),
    current: p.chosen,
  });

  const others = projects.filter((p) => !p.chosen && p.openTasks);
  const text = [...steps];
  if (others.length) text.push(`Also open: ${short(others[0].name, 28)} (${others[0].openTasks})${others.length > 1 ? `, +${others.length - 1}` : ''}`);

  return {
    quota,
    plan,
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
  [/Submitted /, 6, 'Pull request opened', true],
  [/Dry run: nothing pushed/, 6, 'Dry run done, nothing pushed', true],
  [/Verified:/, 6, 'Opening pull request'],
  [/^›\s{2,}([\w.-]+): /, 5, (m) => `Running check: ${m[1]}`],
  [/Verifying in (\w+) sandbox/, 5, 'Running checks in sandbox'],
  [/Agent (\w+) working \(attempt (\d+)/, 4, (m) => `Agent ${m[1]} writing, attempt ${m[2]}`],
  [/Claiming (\S+?):/, 3, (m) => `Claiming ${m[1]}`],
  [/Not donating now/, 1, 'Reserve reached, nothing spent', true],
  [/Checking your quota/, 1, 'Checking quota'],
  [/Syncing /, 1, 'Syncing the project'],
];

/**
 * Where a `swarm run` job is, read from its log: the checklist step it is on (1-based, matching
 * `steps` in the briefing), what it is doing right now in a few words, and whether it has ended.
 */
export function jobProgress(log) {
  const lines = String(log || '').split('\n').filter((l) => l.trim());
  const failed = lines.findLast((l) => /^\s*✗ /.test(l))?.replace(/^\s*✗\s*/, '') || null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    for (const [re, step, now, done] of STAGES) {
      const m = re.exec(line);
      if (!m) continue;
      const out = { step, now: typeof now === 'function' ? now(m) : now, done: Boolean(done) };
      const url = step === 6 && done ? /https?:\/\/\S+/.exec(line) : null;
      if (url) out.pullRequest = url[0];
      // A failed check is news while the agent gets another attempt, and stale once checks pass.
      if (failed && !done && step < 6) out.problem = shortTitle(failed, 7);
      return out;
    }
  }
  return { step: 0, now: 'Starting', done: false };
}
