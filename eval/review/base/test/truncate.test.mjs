import test from 'node:test';
import assert from 'node:assert/strict';
import { truncate } from '../src/truncate.mjs';

test('cuts long text and adds the ellipsis', () => {
  assert.equal(truncate('hello world', { width: 8 }), 'hello...');
  assert.equal(truncate('hello world', { width: 8, ellipsis: '~' }), 'hello w~');
});

test('short text is unchanged', () => {
  assert.equal(truncate('hello'), 'hello');
});
