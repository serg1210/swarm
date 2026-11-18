# textkit

Small text helpers with no dependencies. `node --test test/*.test.mjs` runs the tests.

## Deprecations

- `parseDuration` with a bare number (`'90'`) is deprecated: always give a unit (`'90s'`). The old
  form is no longer supported and its test is skipped until the test is removed.
