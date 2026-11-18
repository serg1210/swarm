// How many independent approvals a change needs. A project sets a base number and can raise
// it for sensitive paths:
//
//   "review": { "quorum": 1, "tiers": [{ "paths": ["src/sandbox.mjs", "src/board/**"], "quorum": 2 }] }
//
// A change needs the largest quorum among the base and every tier it touches. Tiers can only
// raise the requirement, never lower it.
//
// The same block says how many submissions for one task may be rejected in review before the
// task stops being offered to workers: "review": { "maxRejections": 3 }.
import { matchesAny } from './util.mjs';

const MAX_REJECTIONS = 3;

/** How many rejected submissions park a task. Anything but a positive number means the default. */
export function maxRejections(project) {
  const n = Number(project?.review?.maxRejections);
  return Number.isFinite(n) && n >= 1 ? n : MAX_REJECTIONS;
}

export function requiredQuorum(project, files = []) {
  const base = Number(project?.review?.quorum) || 1;
  let need = base;
  for (const tier of project?.review?.tiers || []) {
    if (!tier || !Array.isArray(tier.paths) || typeof tier.quorum !== 'number' || !Number.isFinite(tier.quorum)) continue;
    if (files.some((f) => matchesAny(f, tier.paths))) need = Math.max(need, tier.quorum);
  }
  return need;
}
