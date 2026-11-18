---
title: "Add wrap(text, width)"
---
## Goal

Add `src/wrap.mjs` exporting `wrap(text, width)`, which breaks text into lines for terminal output.

## Acceptance

- Returns an array of lines. Words within a line are separated by single spaces.
- No line is longer than `width`, unless a single word is itself longer than `width`; that word
  gets a line of its own.
- A run of whitespace in the input counts as one separator. Empty input returns an empty array.
- No dependencies. Add tests in `test/wrap.test.mjs`.
