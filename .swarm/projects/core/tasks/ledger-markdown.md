---
title: Add `swarm ledger --markdown` to print the ledger as a Markdown table
size: S
paths: ["src/ledger-markdown.mjs", "src/cli.mjs", "test/**"]
verify: ["node --test .swarm/projects/core/tasks/ledger-markdown.test.mjs"]
---
## Goal

Projects want to paste the contribution ledger into a README or a release note. Add a Markdown
rendering of the board that `leaderboard()` in `src/ledger.mjs` returns.

## Acceptance

- New module `src/ledger-markdown.mjs` exporting `ledgerMarkdown(board)`, returning a string that
  ends with exactly one newline.
  - With no workers it is exactly `No merged receipts yet.` and a newline.
  - Otherwise: a totals sentence, a blank line, then a table.
    - Totals: `4 verified tasks from 2 workers, $1.75 API-equivalent quota donated.` with the
      singular forms `1 verified task` and `1 worker`.
    - Header `| Worker | Tasks | Donated | Agents |` and separator `| --- | ---: | ---: | --- |`.
    - One row per worker, in the order given: handle, task count, cost with two decimals, and the
      runners joined with `, ` (a single `-` when there are none).
    - A `|` in a handle is written `\|`, and a handle that is missing or empty is shown as the
      worker id.
- `swarm ledger --markdown` prints it. Add `markdown` to the boolean flags in `src/cli.mjs`.
- Add unit tests under `test/`.
