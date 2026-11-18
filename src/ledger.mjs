// The contribution ledger is the set of signed receipts merged into the repository.
import { c, fmtUsd } from './util.mjs';

export function leaderboard(receipts) {
  const valid = receipts.filter((r) => r.valid && r.kind === 'receipt');
  const workers = new Map();
  for (const r of valid) {
    const w = workers.get(r.signer.id) || { id: r.signer.id, handle: r.signer.handle, tasks: 0, costUsd: 0, linesChanged: 0, runners: new Set(), last: r.ts };
    w.tasks += 1;
    w.costUsd += r.usage?.costUsd || 0;
    w.linesChanged += r.linesChanged || 0;
    w.runners.add(r.agent?.runner);
    w.handle = r.signer.handle;
    if (String(r.ts) > String(w.last)) w.last = r.ts;
    workers.set(r.signer.id, w);
  }
  const rows = [...workers.values()]
    .map((w) => ({ ...w, runners: [...w.runners].filter(Boolean).sort(), costUsd: Math.round(w.costUsd * 100) / 100 }))
    .sort((a, b) => b.tasks - a.tasks || b.costUsd - a.costUsd);
  const tokens = (r) => (r.usage?.inputTokens || 0) + (r.usage?.outputTokens || 0);
  // Per-project totals over every valid receipt, so the page does not depend on the capped `recent` list.
  // `hours` buckets the last 8 days by UTC hour, which is what the page projects a daily and weekly pace from.
  // No prototype: project ids come from repositories, and one named `constructor` must be only a key.
  const byProject = Object.create(null);
  const cutoff = Date.now() - 8 * 86_400_000;
  const week = Date.now() - 7 * 86_400_000;
  for (const r of valid) {
    const p = (byProject[r.project] ||= { tasks: 0, costUsd: 0, tokens: 0, linesChanged: 0, people: new Set(), agents: new Set(), weekAgents: new Set(), workers: new Map(), first: r.ts, last: r.ts, hours: Object.create(null) });
    p.tasks += 1;
    p.costUsd += r.usage?.costUsd || 0;
    p.tokens += tokens(r);
    p.linesChanged += r.linesChanged || 0;
    p.people.add(r.signer.handle);
    p.agents.add(r.signer.id);
    if (Date.parse(r.ts) > week) p.weekAgents.add(r.signer.id);
    const w = p.workers.get(r.signer.id) || { id: r.signer.id, handle: r.signer.handle, tasks: 0, costUsd: 0, linesChanged: 0, runners: new Set() };
    w.tasks += 1;
    w.costUsd += r.usage?.costUsd || 0;
    w.linesChanged += r.linesChanged || 0;
    w.runners.add(r.agent?.runner);
    p.workers.set(r.signer.id, w);
    if (String(r.ts) > String(p.last)) p.last = r.ts;
    if (String(r.ts) < String(p.first)) p.first = r.ts;
    if (Date.parse(r.ts) > cutoff) {
      const h = (p.hours[new Date(r.ts).toISOString().slice(0, 13)] ||= { costUsd: 0, tasks: 0 });
      h.costUsd = Math.round((h.costUsd + (r.usage?.costUsd || 0)) * 10000) / 10000;
      h.tasks += 1;
    }
  }
  for (const p of Object.values(byProject)) {
    p.costUsd = Math.round(p.costUsd * 100) / 100;
    p.people = [...p.people].sort();
    p.agents = [...p.agents].sort();
    p.weekAgents = [...p.weekAgents].sort();
    p.workers = [...p.workers.values()]
      .map((w) => ({ ...w, runners: [...w.runners].filter(Boolean).sort(), costUsd: Math.round(w.costUsd * 100) / 100 }))
      .sort((a, b) => b.tasks - a.tasks || b.costUsd - a.costUsd);
  }
  return {
    generatedAt: new Date().toISOString(),
    byProject,
    totals: {
      tasks: valid.length,
      workers: rows.length,
      costUsd: Math.round(valid.reduce((n, r) => n + (r.usage?.costUsd || 0), 0) * 100) / 100,
      invalidReceipts: receipts.length - valid.length,
    },
    workers: rows,
    recent: valid
      .slice(-20)
      .reverse()
      .map((r) => ({ task: `${r.project}/${r.task}`, worker: r.signer.id, handle: r.signer.handle, runner: r.agent?.runner, model: r.agent?.model, costUsd: r.usage?.costUsd || 0, tokens: tokens(r), linesChanged: r.linesChanged || 0, ts: r.ts })),
  };
}

export function renderLeaderboard(board) {
  const lines = [
    `${c.bold('Swarm ledger')}: ${board.totals.tasks} verified task(s) from ${board.totals.workers} worker(s), ${fmtUsd(board.totals.costUsd)} API-equivalent quota donated`,
    '',
  ];
  if (!board.workers.length) lines.push(c.dim('  No merged receipts yet.'));
  board.workers.forEach((w, i) => {
    lines.push(`  ${String(i + 1).padStart(2)}. ${w.handle.padEnd(18)} ${c.dim(w.id)}  ${String(w.tasks).padStart(3)} task(s)  ${fmtUsd(w.costUsd).padStart(8)}  ${c.dim(w.runners.join(','))}`);
  });
  return lines.join('\n');
}
