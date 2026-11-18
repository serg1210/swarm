---
title: Add `swarm doctor --json` for machine-readable checks
size: S
paths: ["src/cli.mjs", "test/**"]
verify: ["node --test .swarm/projects/core/tasks/doctor-json.test.mjs"]
---
## Goal

Agent hosts run `swarm doctor` and then have to read ticks and crosses out of coloured text. Give
them JSON.

## Acceptance

- `swarm doctor --json` prints exactly one JSON document on stdout and nothing else there:
  `{ "ok": <boolean>, "checks": [{ "ok": <boolean>, "label": <string>, "detail": <string> }] }`.
  - It contains the same checks, in the same order, with the same labels and details as the text
    output, without colour codes. `detail` is an empty string when a check has none.
  - Top-level `ok` is true only when every check that counts as a failure in the text output
    passed. The identity line is informational there and stays informational here.
  - The exit code is 0 when `ok` is true and 1 otherwise, as it is today.
- Without `--json` the output is unchanged.
- Add a test under `test/`.
