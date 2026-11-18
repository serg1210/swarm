import test from 'node:test';
import assert from 'node:assert/strict';
import { isLeapYear, daysInMonth, parseDate, formatDate, addDays, diffDays, weekday, startOfWeek } from '../src/dates.mjs';

test('leap years', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2023), false);
  assert.equal(isLeapYear(1900), false);
  assert.equal(isLeapYear(2000), true);
});

test('days in a month', () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2023, 2), 28);
  assert.equal(daysInMonth(2024, 4), 30);
  assert.equal(daysInMonth(2024, 12), 31);
  assert.throws(() => daysInMonth(2024, 0), RangeError);
  assert.throws(() => daysInMonth(2024, 13), RangeError);
});

test('parse and format round-trip at midnight UTC', () => {
  for (const s of ['2024-01-01', '2024-02-29', '1999-12-31']) assert.equal(formatDate(parseDate(s)), s);
  assert.equal(parseDate('2024-03-10').getTime(), Date.UTC(2024, 2, 10));
});

test('parseDate rejects what is not a real date', () => {
  for (const s of ['2024-13-01', '2024-00-10', '2024-01-32', '2024-01-00', '2024-1-5', '24-01-05', 'yesterday', '', '2024-02-30', '2023-02-29', '2024-04-31']) {
    assert.throws(() => parseDate(s), /date/, s);
  }
});

test('formatDate uses the UTC day', () => {
  assert.equal(formatDate(new Date('2024-06-30T23:59:59Z')), '2024-06-30');
  assert.equal(formatDate(new Date('2024-07-01T00:00:00Z')), '2024-07-01');
});

test('addDays crosses months, years and clock changes', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-28', 2), '2024-03-01');
  assert.equal(addDays('2024-01-01', -1), '2023-12-31');
  assert.equal(addDays('2024-03-09', 2), '2024-03-11');
  assert.equal(addDays('2024-12-31', 366), '2026-01-01');
});

test('diffDays', () => {
  assert.equal(diffDays('2024-01-01', '2024-01-31'), 30);
  assert.equal(diffDays('2024-03-01', '2024-02-28'), -2);
  assert.equal(diffDays('2024-05-05', '2024-05-05'), 0);
  assert.equal(diffDays('2023-01-01', '2024-01-01'), 365);
  assert.equal(diffDays('2024-01-01', '2025-01-01'), 366);
});

test('weekday', () => {
  assert.equal(weekday('2024-05-13'), 'Mon');
  assert.equal(weekday('2024-05-19'), 'Sun');
  assert.equal(weekday('2000-01-01'), 'Sat');
});

test('startOfWeek is the Monday of that week', () => {
  assert.equal(startOfWeek('2024-05-15'), '2024-05-13');
  assert.equal(startOfWeek('2024-05-13'), '2024-05-13');
  assert.equal(startOfWeek('2024-05-18'), '2024-05-13');
  assert.equal(startOfWeek('2024-08-01'), '2024-07-29');
  assert.equal(startOfWeek('2024-05-19'), '2024-05-13');
  assert.equal(startOfWeek('2024-01-07'), '2024-01-01');
});
