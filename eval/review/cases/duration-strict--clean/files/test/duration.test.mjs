import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/duration.mjs';

test('hours and minutes', () => {
  assert.equal(parseDuration('1h30m'), 5400);
});

test('seconds', () => {
  assert.equal(parseDuration('45s'), 45);
});

test('a bare number is rejected', () => {
  assert.throws(() => parseDuration('90'), /needs a unit/);
  assert.throws(() => parseDuration(' 5 '), /needs a unit/);
});
