---
title: "Add retry(fn, { attempts })"
---
## Goal

Add `src/retry.mjs` exporting `retry(fn, { attempts = 3 })` for operations that sometimes fail.

## Acceptance

- Calls `fn(attempt)` with the attempt number, starting at 0, and returns a promise for its result.
- `fn` may be synchronous or asynchronous. If it throws, or returns a promise that rejects, it is
  called again, up to `attempts` calls in total.
- When every attempt fails, the promise rejects with the last error.
- No dependencies. Add tests in `test/retry.test.mjs`.
