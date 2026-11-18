import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.mjs';

test('defaults', () => {
  assert.deepEqual(loadConfig(), { maxWidth: 80, ellipsis: '...' });
});

test('caller options win', () => {
  assert.equal(loadConfig({ maxWidth: 40 }).maxWidth, 40);
  assert.equal(loadConfig({ ellipsis: '~' }).ellipsis, '~');
});

test('width is an alias for maxWidth, and maxWidth wins', () => {
  assert.deepEqual(loadConfig({ width: 40 }), { maxWidth: 40, ellipsis: '...' });
  assert.equal(loadConfig({ width: 40, maxWidth: 60 }).maxWidth, 60);
});
