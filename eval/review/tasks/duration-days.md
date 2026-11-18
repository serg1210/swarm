---
title: "parseDuration: support days and reject unknown units"
---
## Goal

`parseDuration('2d')` returns 0: `d` is not a known unit, and unknown units are silently ignored.

## Acceptance

- `d` means days: `parseDuration('1d2h')` equals `parseDuration('26h')`.
- An unknown unit throws an `Error` whose message names the unit, for example `parseDuration('5x')`.
- Existing behaviour is otherwise unchanged, including a bare number meaning seconds. Add tests.
