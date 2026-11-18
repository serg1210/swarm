import test from 'node:test';
import assert from 'node:assert/strict';
import { banner } from '../src/banner.mjs';

test('centres text within the given width', () => {
  assert.equal(banner('hi', { maxWidth: 10 }), '    hi');
  assert.equal(banner('hi', { width: 10 }), '    hi');
});

test('centres within the default width', () => {
  assert.equal(banner('hi'), ' '.repeat(39) + 'hi');
});

test('text wider than the width is unchanged', () => {
  assert.equal(banner('a long title', { maxWidth: 4 }), 'a long title');
});
