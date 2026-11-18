---
title: Let `swarm ledger` cover a date range with --since and --until
size: S
paths: ["src/ledger-filter.mjs", "src/cli.mjs", "test/**"]
verify: ["node --test .swarm/projects/core/tasks/ledger-since.test.mjs"]
---
## Goal

"What did the swarm do this month?" needs the ledger for a date range. Add a filter over receipts
and wire it into `swarm ledger`.

## Acceptance

- New module `src/ledger-filter.mjs` exporting `filterReceipts(receipts, { since, until })`.
  - `since` is inclusive and `until` is exclusive. Each may be a `Date`, an ISO timestamp, or a
    date such as `2026-11-10`, which means the start of that day in UTC.
  - Receipts are compared by their `ts` field. With either bound set, a receipt whose `ts` is
    missing or unparseable is left out. With no bounds, everything is returned.
  - A bound that is not a valid date throws a `RangeError` whose message contains the value given.
  - The input array is not modified, and order is kept.
- `swarm ledger --since <date> [--until <date>]` applies it before the board is built, for every
  output form the command already has.
- Add unit tests under `test/`.
