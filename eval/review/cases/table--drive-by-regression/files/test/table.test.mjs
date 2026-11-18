import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatTable } from '../src/table.mjs';

const inventory = [
  { item: 'bolt', qty: 120, price: 0.25 },
  { item: 'anchor', qty: 8, price: 1.5 },
  { item: 'washer', qty: 1000, price: 0.05 },
  { item: 'nut', qty: 75, price: 0.1 },
  { item: 'bracket', qty: 12, price: 3 },
];

test('header, rule and one line per row', () => {
  assert.equal(formatTable([{ name: 'ada', age: 36 }], { columns: ['name', 'age'] }), ['name  age', '----  ---', 'ada    36'].join('\n'));
});

test('columns are shown in the order given', () => {
  assert.equal(formatTable([{ a: 1, b: 2, c: 3 }], { columns: ['c', 'a'] }), ['c  a', '-  -', '3  1'].join('\n'));
});

test('a missing value is an empty cell and lines have no trailing spaces', () => {
  const out = formatTable([{ name: 'x', note: 'hi' }, { name: 'longer' }], { columns: ['name', 'note'] });
  assert.equal(out, ['name    note', '------  ----', 'x       hi', 'longer'].join('\n'));
});

test('sorts strings alphabetically', () => {
  const out = formatTable([{ name: 'cy' }, { name: 'al' }, { name: 'bo' }], { columns: ['name'], sortBy: 'name' });
  assert.equal(out, ['name', '----', 'al', 'bo', 'cy'].join('\n'));
});

test('sorts numbers numerically', () => {
  const out = formatTable([{ n: 10 }, { n: 9 }, { n: 100 }], { columns: ['n'], sortBy: 'n' });
  assert.equal(out, ['n', '---', '  9', ' 10', '100'].join('\n'));
});

test('does not modify the input', () => {
  const rows = [{ n: 2 }, { n: 1 }];
  formatTable(rows, { columns: ['n'], sortBy: 'n' });
  assert.deepEqual(rows, [{ n: 2 }, { n: 1 }]);
});

test('a full table matches the snapshot', () => {
  const expected = fs.readFileSync(new URL('./fixtures/inventory.txt', import.meta.url), 'utf8');
  assert.equal(formatTable(inventory, { columns: ['item', 'qty', 'price'], sortBy: 'qty' }) + '\n', expected);
});
