---
title: Add a README badge showing a project's verified task count
size: S
paths: ["src/badge.mjs", "src/cli.mjs", "test/**"]
verify: ["node --test .swarm/projects/core/tasks/badge.test.mjs"]
---
## Goal

Maintainers who adopt Swarm want to show it in their README. Add a small SVG badge that says how
many verified tasks have been merged and by how many workers, built from the ledger.

## Acceptance

- New module `src/badge.mjs` exporting `badgeSvg({ label, tasks, workers })`, returning one SVG
  string with no dependencies and no external resources: no scripts, no images, no `href`
  attributes and no web addresses.
  - `label` defaults to `swarm`. The message is `<tasks> tasks, <workers> workers`, with the
    singular forms `1 task` and `1 worker`.
  - The root element is `<svg xmlns="http://www.w3.org/2000/svg" ...>` with a numeric `width`, a
    `role="img"`, an `aria-label` of `<label>: <message>` and a `<title>` with the same text.
  - The label and the message each appear in a `<text>` element. A longer message gives a wider badge.
  - `&`, `<`, `>` and `"` in the label are escaped everywhere they appear.
  - `tasks` and `workers` must be non-negative integers; anything else throws a `TypeError`.
- `swarm badge [--out <file>]` prints (or writes) the badge for the ledger of the current
  repository, the same way `swarm ledger` finds it.
- Add unit tests under `test/`.
