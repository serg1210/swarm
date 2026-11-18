import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slug.mjs';

test('lowercases and replaces spaces', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('keeps digits', () => {
  assert.equal(slugify('Top 10'), 'top-10');
});

test('maxLength cuts the slug', () => {
  assert.equal(slugify('hello world', { maxLength: 8 }), 'hello-wo');
  assert.equal(slugify('hello world', { maxLength: 100 }), 'hello-world');
});

test('maxLength never leaves a trailing dash', () => {
  assert.equal(slugify('hello world', { maxLength: 6 }), 'hello');
  assert.equal(slugify('a   b', { maxLength: 3 }), 'a');
});

test('without maxLength nothing changes', () => {
  assert.equal(slugify('a b '), 'a-b-');
});
