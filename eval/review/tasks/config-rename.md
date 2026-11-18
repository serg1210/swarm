---
title: "config: rename the width option to maxWidth"
---
## Goal

The `width` option is a maximum, and people keep reading it as an exact width. Rename it to
`maxWidth`.

## Acceptance

- `loadConfig()` returns `maxWidth`, default 80, instead of `width`.
- The old name still works as an alias: `loadConfig({ width: 40 }).maxWidth` is 40. When both are
  given, `maxWidth` wins.
- The helpers behave exactly as before for every caller. Update the tests.
