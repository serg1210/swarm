import test from 'node:test';
import assert from 'node:assert/strict';
import { wrap } from '../src/wrap.mjs';

test('breaks when the next word does not fit', () => {
  assert.deepEqual(wrap('hello world', 5), ['hello', 'world']);
  assert.deepEqual(wrap('aaa bbb ccc', 20), ['aaa bbb ccc']);
});

test('a word longer than the width gets its own line', () => {
  assert.deepEqual(wrap('a incomprehensible b', 5), ['a', 'incomprehensible', 'b']);
});

test('whitespace runs are one separator and empty input gives no lines', () => {
  assert.deepEqual(wrap('  a \n\t b  ', 10), ['a b']);
  assert.deepEqual(wrap('', 10), []);
  assert.deepEqual(wrap('   ', 10), []);
});
