#!/usr/bin/env node
// Runs the reviewer eval with a real agent and prints how many planted problems it caught.
//
//   node eval/review/run.mjs                       every case once, with the first agent CLI found
//   node eval/review/run.mjs --runs 3              three times each, to see how steady the verdicts are
//   node eval/review/run.mjs --only wrap           only cases whose id contains "wrap"
//   node eval/review/run.mjs --runner codex --model <name> --json out.json
//
// This spends quota: one short agent run per case per run. Nothing here is part of the project's
// verify step; test/review-eval.test.mjs checks the harness and the cases without a model.
import fs from 'node:fs';
import { getRunner, detectRunners } from '../../src/runners/index.mjs';
import { pickSandbox } from '../../src/sandbox.mjs';
import { loadCases, checksPass, runEval, summarize, promptFingerprint } from './lib.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
  const next = process.argv[i + 1];
  args[a.slice(2)] = next === undefined || next.startsWith('--') ? true : (i++, next);
}

const runnerName = args.runner || (await detectRunners())[0];
if (!runnerName) throw new Error('No agent CLI found. Install Claude Code (`claude`) or Codex (`codex`), or pass --runner.');
const runner = getRunner(runnerName);
const cases = loadCases().filter((c) => !args.only || String(args.only).split(',').some((s) => c.id.includes(s)));
if (!cases.length) throw new Error('No cases match --only.');
const runs = Number(args.runs ?? 1);

if (!args['skip-checks']) {
  const sandbox = args['unsafe-no-sandbox'] ? 'none' : await pickSandbox({});
  for (const c of cases) {
    const res = await checksPass(c, { sandbox });
    if (!res.ok) throw new Error(`Case ${c.id} is broken: its change fails the fixture's own checks, so it proves nothing.\n${res.output}`);
  }
  console.log(`${cases.length} cases pass the fixture's checks (${sandbox} sandbox). Asking ${runnerName}${args.model ? ` (${args.model})` : ''}, ${runs} run(s) each.\n`);
}

const mark = { caught: 'caught', approved: 'ok', missed: 'MISSED', 'false-reject': 'FALSE REJECT', 'rejected-other-reason': 'rejected, other reason', 'no-verdict': 'no verdict' };
const results = await runEval({
  cases,
  runner,
  runs,
  concurrency: Number(args.concurrency ?? 4),
  model: args.model === true ? undefined : args.model,
  budgetUsd: Number(args['budget-usd'] ?? 1),
  onResult: (r) => console.log(`  ${r.kind.padEnd(5)} ${r.id.padEnd(40)} ${mark[r.outcome]}${r.error ? ` (${r.error})` : ''}`),
});

const s = summarize(results);
const model = results.find((r) => r.model)?.model || args.model || 'unknown';
console.log('');
console.log(`Planted problems caught:   ${s.caught}/${s.bad}${s.rejectedOtherReason ? `  (+${s.rejectedOtherReason} rejected for another reason)` : ''}${s.missed ? `  (${s.missed} approved by mistake)` : ''}`);
console.log(`Clean changes approved:    ${s.approved}/${s.clean}${s.falseRejects ? `  (${s.falseRejects} rejected by mistake)` : ''}`);
if (s.noVerdict) console.log(`No verdict:                ${s.noVerdict}`);
console.log(`Runner ${runnerName}, model ${model}, review prompt ${promptFingerprint()}, cost $${s.costUsd.toFixed(2)} API-equivalent.`);
if (results.some((r) => r.rateLimited)) console.log('Stopped early: the account is rate limited.');

for (const r of results.filter((x) => ['missed', 'false-reject', 'rejected-other-reason'].includes(x.outcome))) {
  const c = cases.find((x) => x.id === r.id);
  console.log(`\n--- ${r.id}: ${mark[r.outcome]}${c.answer ? `\n    planted: ${c.answer}` : ''}\n    reviewer said: ${r.notes.replace(/\s+/g, ' ').slice(0, 600)}`);
}

if (typeof args.json === 'string') {
  fs.writeFileSync(args.json, JSON.stringify({ date: new Date().toISOString(), runner: runnerName, model, prompt: promptFingerprint(), runs, summary: s, results }, null, 2) + '\n');
  console.log(`\nWrote ${args.json}`);
}
