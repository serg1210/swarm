---
title: "slugify: collapse runs of separators and trim them from the ends"
---
## Goal

`slugify('  Hello,   World! ')` returns `--hello----world--`. Slugs should not have repeated,
leading or trailing dashes.

## Acceptance

- A run of characters that are not letters or digits becomes a single dash.
- The result never starts or ends with a dash.
- `slugify('  Hello,   World! ')` returns `hello-world`.
- Existing behaviour is otherwise unchanged. Add tests.
