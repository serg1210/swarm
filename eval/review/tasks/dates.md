---
title: "Add date helpers"
---
## Goal

Add `src/dates.mjs` with small helpers for calendar dates written as `YYYY-MM-DD`. Reports are
generated on machines in different time zones and must come out the same everywhere.

## Acceptance

- `parseDate(str)` returns a `Date` at midnight UTC of that day. It throws on anything that is not
  a real date written as `YYYY-MM-DD`.
- `formatDate(date)` returns `YYYY-MM-DD` for the UTC day of a `Date`.
- `addDays(str, n)` returns the date `n` days later, or earlier for a negative `n`, as a string.
- `diffDays(a, b)` returns the whole number of days from `a` to `b`.
- `weekday(str)` returns `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat` or `Sun`.
- `startOfWeek(str)` returns the Monday of that date's week. Weeks run Monday to Sunday.
- `daysInMonth(year, month)` with `month` from 1 to 12, and `isLeapYear(year)`.
- Every function works in UTC: no result depends on the machine's time zone. Years before 1000
  need not be supported.
- No dependencies. Add tests in `test/dates.test.mjs`.
