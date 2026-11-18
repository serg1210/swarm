import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slug.mjs';

test('lowercases and replaces spaces', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('keeps digits', () => {
  assert.equal(slugify('Top 10'), 'top-10');
});

test('collapses runs of separators', () => {
  assert.equal(slugify('a -- b'), 'a-b');
  assert.equal(slugify('one,  two;three'), 'one-two-three');
});

test('never starts or ends with a dash', () => {
  assert.equal(slugify('  Hello,   World! '), 'hello-world');
  assert.equal(slugify('!wow!'), 'wow');
  assert.equal(slugify('---'), '');
});
