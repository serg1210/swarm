import test from 'node:test';
import assert from 'node:assert/strict';
import { banner } from '../src/banner.mjs';

test('centres text within the given width', () => {
  assert.equal(banner('hi', { width: 10 }), '    hi');
});

test('text wider than the width is unchanged', () => {
  assert.equal(banner('a long title', { width: 4 }), 'a long title');
});
