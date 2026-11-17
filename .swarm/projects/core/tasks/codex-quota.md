---
title: Read Codex rate-limit windows from local session rollouts
size: M
paths: ["src/quota-codex.mjs", "test/**"]
verify: ["node --test .swarm/projects/core/tasks/codex-quota.test.mjs"]
---
## Goal

`swarm run` keeps a reserve of the volunteer's quota. For Claude Code the windows come from the
CLI's own output. `codex exec --json` does not report rate limits, so with the Codex runner the
guard is blind. Codex does write them to its session rollout files
(`~/.codex/sessions/**/rollout-*.jsonl`): lines whose payload is a `token_count` event carrying
`rate_limits.primary` and `rate_limits.secondary`, each `{ used_percent, window_minutes, resets_at }`.

Write the parser. Wiring it into the runner (`src/runners/codex.mjs`) is a separate task.

## Acceptance

- New module `src/quota-codex.mjs` exporting:
  - `parseRollout(text)`: scans JSON lines and returns the rate limits from the LAST `token_count`
    event that has them, normalized to the shape the quota guard uses:
    `{ status: 'allowed', fiveHour: { utilization, resetsAt }, weekly: { utilization, resetsAt } }`
    or `null` when there is none. `utilization` is `used_percent / 100`. `resetsAt` is an ISO string
    (`resets_at` is epoch seconds) or `null`. The window with the smaller `window_minutes` is
    `fiveHour`, the other is `weekly`; a missing window is `null`. The event may sit at the top
    level of the line (`{ "type": "token_count", "rate_limits": ... }`) or under `payload`
    (`{ "type": "event_msg", "payload": { "type": "token_count", "rate_limits": ... } }`); handle both.
    Malformed lines are skipped.
  - `latestRollout(dir)`: returns the path of the most recently modified `rollout-*.jsonl` anywhere
    under `dir`, or `null`. Must not throw when `dir` does not exist.
- It only reads files. It must never read `auth.json` or anything outside the sessions directory.
- Unit tests in `test/`.

The pinned acceptance test is `.swarm/projects/core/tasks/codex-quota.test.mjs`.
