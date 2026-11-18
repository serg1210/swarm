import test from 'node:test';
import assert from 'node:assert/strict';
import { filterReceipts } from '../../../../src/ledger-filter.mjs';

const receipts = [
  { task: 'a', ts: '2026-11-09T23:59:59.999Z' },
  { task: 'b', ts: '2026-11-10T00:00:00.000Z' },
  { task: 'c', ts: '2026-11-15T12:00:00.000Z' },
  { task: 'd', ts: '2026-11-20T00:00:00.000Z' },
  { task: 'e' },
  { task: 'f', ts: 'not a date' },
];
const ids = (list) => list.map((r) => r.task).join('');

test('since is inclusive, until is exclusive', () => {
  assert.equal(ids(filterReceipts(receipts, { since: '2026-11-10' })), 'bcd');
  assert.equal(ids(filterReceipts(receipts, { until: '2026-11-20' })), 'abc');
  assert.equal(ids(filterReceipts(receipts, { since: '2026-11-10', until: '2026-11-20' })), 'bc');
  assert.equal(ids(filterReceipts(receipts, { since: '2026-11-15T12:00:00.000Z', until: new Date('2026-11-15T12:00:00.001Z') })), 'c');
  assert.equal(ids(filterReceipts(receipts, { since: new Date('2026-11-20T00:00:00.000Z') })), 'd');
});

test('no bounds returns everything, in order, without touching the input', () => {
  const copy = JSON.parse(JSON.stringify(receipts));
  assert.equal(ids(filterReceipts(receipts, {})), 'abcdef');
  assert.equal(ids(filterReceipts(receipts)), 'abcdef');
  assert.deepEqual(receipts, copy);
  assert.notEqual(filterReceipts(receipts, {}), receipts);
});

test('a bad bound is an error that names the value', () => {
  assert.throws(() => filterReceipts(receipts, { since: 'last tuesday' }), (err) => err instanceof RangeError && err.message.includes('last tuesday'));
  assert.throws(() => filterReceipts(receipts, { until: 'soon' }), (err) => err instanceof RangeError && err.message.includes('soon'));
});
