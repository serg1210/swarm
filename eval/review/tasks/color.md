---
title: "Add paint(text, color)"
---
## Goal

Add `src/color.mjs` exporting `paint(text, color)` for coloured terminal output.

## Acceptance

- `color` is one of `red`, `green` or `yellow`. The text is wrapped in the matching ANSI escape
  code and a reset.
- When the `NO_COLOR` environment variable is set to a non-empty value, the text is returned
  unchanged (the no-color.org convention).
- An unknown colour throws.
- No dependencies. Add tests in `test/color.test.mjs`.
