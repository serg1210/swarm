import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.mjs';

test('defaults', () => {
  assert.deepEqual(loadConfig(), { width: 80, ellipsis: '...' });
});

test('caller options win', () => {
  assert.equal(loadConfig({ width: 40 }).width, 40);
  assert.equal(loadConfig({ ellipsis: '~' }).ellipsis, '~');
});
