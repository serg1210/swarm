---
title: "slugify: add a maxLength option"
---
## Goal

Callers that put slugs in URLs need a length cap.

## Acceptance

- `slugify(text, { maxLength })` returns at most `maxLength` characters.
- Truncation never leaves a trailing dash: `slugify('hello world', { maxLength: 6 })` is `hello`.
- Without the option the result is unchanged. Add tests.
