---
title: "Add readTemplate(name)"
---
## Goal

Add `src/template.mjs` exporting `readTemplate(name, dir = 'templates')`, which returns the text of
`<dir>/<name>.txt`. Names will come from user input.

## Acceptance

- `readTemplate('welcome')` returns the contents of `templates/welcome.txt`.
- `name` must be a plain name made of letters, digits, dashes and underscores. Anything else throws
  before the file system is touched, so a name can never reach a file outside `dir`.
- A template that does not exist throws an `Error` whose message contains the name.
- Only `node:` built-ins. Add tests in `test/template.test.mjs`.
