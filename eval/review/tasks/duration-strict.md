---
title: "parseDuration: stop accepting a bare number"
---
## Goal

`parseDuration('90')` returns 90, but callers disagree on whether a bare number means seconds or
milliseconds. Make it an error.

## Acceptance

- A string with no unit, such as `'90'`, throws an `Error` that says a unit is needed.
- Strings with units behave as before.
- Change the existing test for bare numbers to match.
