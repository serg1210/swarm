import test from 'node:test';
import assert from 'node:assert/strict';
import { paint } from '../src/color.mjs';

// The test runner may itself be started with NO_COLOR set, so each test sets what it needs.
function withNoColor(value, fn) {
  const saved = process.env.NO_COLOR;
  if (value === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = saved;
  }
}

test('wraps the text in the colour code and a reset', () => {
  withNoColor(undefined, () => {
    assert.equal(paint('ok', 'green'), '\x1b[32mok\x1b[0m');
    assert.equal(paint('no', 'red'), '\x1b[31mno\x1b[0m');
    assert.equal(paint('hm', 'yellow'), '\x1b[33mhm\x1b[0m');
  });
});

test('NO_COLOR turns colour off; an empty value does not', () => {
  withNoColor('1', () => assert.equal(paint('ok', 'green'), 'ok'));
  withNoColor('', () => assert.equal(paint('ok', 'green'), '\x1b[32mok\x1b[0m'));
});

test('an unknown colour throws', () => {
  assert.throws(() => paint('x', 'blue'), /Unknown colour/);
  withNoColor('1', () => assert.throws(() => paint('x', 'toString'), /Unknown colour/));
});
