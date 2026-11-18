import test from 'node:test';
import assert from 'node:assert/strict';
import { wrap } from '../src/wrap.mjs';

test('fills each line up to the width', () => {
  assert.deepEqual(wrap('aaa bbb ccc', 7), ['aaa bbb', 'ccc']);
  assert.deepEqual(wrap('aaa bbb', 6), ['aaa', 'bbb']);
});

test('no line is longer than the width', () => {
  for (const width of [5, 9, 12, 20]) {
    for (const line of wrap('the quick brown fox jumps over the lazy dog', width)) assert.ok(line.length <= width, `${line} at ${width}`);
  }
});

test('a word longer than the width gets its own line', () => {
  assert.deepEqual(wrap('a incomprehensible b', 5), ['a', 'incomprehensible', 'b']);
});

test('whitespace runs are one separator and empty input gives no lines', () => {
  assert.deepEqual(wrap('  a \n\t b  ', 10), ['a b']);
  assert.deepEqual(wrap('', 10), []);
  assert.deepEqual(wrap('   ', 10), []);
});
