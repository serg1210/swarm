// How many independent approvals a change needs. A project sets a base number and can raise
// it for sensitive paths:
//
//   "review": { "quorum": 1, "tiers": [{ "paths": ["src/sandbox.mjs", "src/board/**"], "quorum": 2 }] }
//
// A change needs the largest quorum among the base and every tier it touches. Tiers can only
// raise the requirement, never lower it.
import { matchesAny } from './util.mjs';

export function requiredQuorum(project, files = []) {
  const base = Number(project?.review?.quorum) || 1;
  let need = base;
  for (const tier of project?.review?.tiers || []) {
    if (!tier || !Array.isArray(tier.paths) || typeof tier.quorum !== 'number' || !Number.isFinite(tier.quorum)) continue;
    if (files.some((f) => matchesAny(f, tier.paths))) need = Math.max(need, tier.quorum);
  }
  return need;
}
