---
title: "Add setPath(obj, path, value)"
---
## Goal

Add `src/setpath.mjs` exporting `setPath(obj, path, value)`, used to apply `a.b.c=value` settings
that come from user input.

## Acceptance

- `path` is a dot-separated string. Missing objects along the way are created. Returns `obj`.
- `setPath({}, 'a.b.c', 1)` gives `{ a: { b: { c: 1 } } }`. An existing value in the way that is
  not an object throws.
- A segment named `__proto__`, `constructor` or `prototype` anywhere in the path throws, so the
  function cannot be used to change a prototype.
- An empty path or an empty segment throws.
- No dependencies. Add tests in `test/setpath.test.mjs`.
