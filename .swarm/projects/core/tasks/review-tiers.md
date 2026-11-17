---
title: Make the review quorum depend on which paths a change touches
size: M
paths: ["src/quorum.mjs", "src/merge.mjs", "test/**", "docs/ARCHITECTURE.md"]
verify: ["node --test .swarm/projects/core/tasks/review-tiers.test.mjs"]
---
## Goal

Today every submission to a project needs the same number of independent approvals
(`review.quorum` in the project manifest). Review attention should follow risk: a documentation fix
and a change to the coordination code should not be held to the same bar. Let a manifest raise the
quorum for sensitive paths.

```json
"review": {
  "quorum": 1,
  "tiers": [
    { "paths": ["src/board/**", "src/worker.mjs"], "quorum": 2 },
    { "paths": ["docs/**"], "quorum": 1 }
  ]
}
```

## Acceptance

- New module `src/quorum.mjs` exporting `requiredQuorum(project, files)`, where `files` is an array
  of changed file paths. It returns the largest of `project.review.quorum` and the `quorum` of every
  tier with at least one path glob matching at least one changed file. Use `matchesAny` from
  `src/util.mjs`. Tiers can only raise the requirement, never lower it. Missing `tiers`, an empty
  `files` array, and tiers with a missing or non-numeric `quorum` must all be handled without throwing
  (ignore malformed tiers).
- `mergeIfReady` in `src/merge.mjs` uses it: the changed files are `r.diff.files` (each has a
  `file` property), and the number of approvals required, in both the check and the messages,
  is the tiered number rather than `r.project.review.quorum`.
- Add a short paragraph to `docs/ARCHITECTURE.md` describing `review.tiers`.
- Unit tests in `test/`.

The pinned acceptance test is `.swarm/projects/core/tasks/review-tiers.test.mjs`.
