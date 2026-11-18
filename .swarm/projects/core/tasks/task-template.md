---
title: Add `swarm new-task` to print a task file skeleton
size: S
paths: ["src/task-template.mjs", "src/cli.mjs", "test/**"]
verify: ["node --test .swarm/projects/core/tasks/task-template.test.mjs"]
---
## Goal

Maintainers write task files by hand and get the frontmatter subtly wrong. Add a generator for a
task file that `parseFrontmatter` in `src/util.mjs` reads back exactly. It only prints; it never
writes into `.swarm` itself.

## Acceptance

- New module `src/task-template.mjs` exporting `taskTemplate({ title, size, paths, verify })`,
  returning the text of a task file: frontmatter, then a body with the headings `## Goal` and
  `## Acceptance`, each followed on the very next line (no blank line between) by a one-line
  placeholder.
  - `title` is required and is trimmed first. A title that is then empty, or contains a line
    break, throws a `TypeError`. Write it so that it reads back as a string whatever it contains.
  - `size` defaults to `S` and must be `S`, `M` or `L`; anything else throws a `RangeError`.
  - `paths` defaults to an empty array and is written as a JSON array on one line.
  - `verify` is a list of commands, written the same way, and the key is left out when the list is
    empty or missing.
  - Reading the result back with `parseFrontmatter` gives the same title as a string (also for
    titles such as `42`, `true`, `Fix: the "thing"` or `[draft] cleanup`), the same size, and
    equal `paths` and `verify` arrays.
- `swarm new-task --title <text> [--size S|M|L] [--paths a,b] [--verify "<command>"]` prints it.
- Add unit tests under `test/`.
