---
title: "Add formatTable(rows, { columns, sortBy })"
---
## Goal

Add `src/table.mjs` exporting `formatTable(rows, options)`, which renders an array of objects as a
plain-text table for terminal output.

## Acceptance

- `columns` is the list of keys to show, in order. The first line is the header (the keys), the
  second a rule of dashes as wide as each column, then one line per row.
- Each column is as wide as its widest cell or its header. Columns are separated by two spaces.
  Lines have no trailing spaces.
- Numbers are right-aligned, everything else is left-aligned. A missing value is an empty cell.
- `sortBy` names a column. Rows are sorted by it in ascending order: numbers numerically, strings
  alphabetically. The input array is not modified.
- No dependencies. Add tests in `test/table.test.mjs`, including one full-table snapshot kept in
  `test/fixtures/`.
