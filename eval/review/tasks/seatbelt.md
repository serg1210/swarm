---
title: "Add seatbeltProfile({ workDir, network })"
---
## Goal

Tests are run on macOS under `sandbox-exec`. Add `src/seatbelt.mjs` exporting
`seatbeltProfile({ workDir, network = false })`, which returns the profile text.

## Acceptance

- The profile starts with `(version 1)` and `(allow default)`, then narrows things down.
- Writes are denied everywhere except under `workDir`, which the caller passes as an absolute path
  with symlinks already resolved. Nothing else needs to stay writable.
- With `network: false`, a sandboxed process cannot open a connection to any other machine.
  Loopback keeps working in both directions, because tests start a local server and connect to it.
- With `network: true`, the profile has no network rules.
- No dependencies. Add tests in `test/seatbelt.test.mjs`. The tests check the profile text; they do
  not run `sandbox-exec`.
