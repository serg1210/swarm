import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slug.mjs';

test('lowercases and replaces spaces', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('keeps digits', () => {
  assert.equal(slugify('Top 10'), 'top-10');
});
