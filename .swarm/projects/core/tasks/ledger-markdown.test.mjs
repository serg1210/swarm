import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerMarkdown } from '../../../../src/ledger-markdown.mjs';

const board = {
  totals: { tasks: 4, workers: 2, costUsd: 1.75, invalidReceipts: 0 },
  workers: [
    { id: 'aaaa1111', handle: 'alice', tasks: 3, costUsd: 1.5, runners: ['claude', 'codex'] },
    { id: 'bbbb2222', handle: 'b|ob', tasks: 1, costUsd: 0.25, runners: [] },
  ],
};

test('totals, header and rows', () => {
  const lines = ledgerMarkdown(board).split('\n');
  assert.equal(lines[0], '4 verified tasks from 2 workers, $1.75 API-equivalent quota donated.');
  assert.equal(lines[1], '');
  assert.equal(lines[2], '| Worker | Tasks | Donated | Agents |');
  assert.equal(lines[3], '| --- | ---: | ---: | --- |');
  assert.equal(lines[4], '| alice | 3 | $1.50 | claude, codex |');
  assert.equal(lines[5], '| b\\|ob | 1 | $0.25 | - |');
  assert.equal(lines.length, 7);
  assert.equal(lines[6], '');
});

test('singular forms and a missing handle', () => {
  const md = ledgerMarkdown({ totals: { tasks: 1, workers: 1, costUsd: 0 }, workers: [{ id: 'cccc3333', handle: '', tasks: 1, costUsd: 0, runners: ['claude'] }] });
  assert.ok(md.startsWith('1 verified task from 1 worker, $0.00 API-equivalent quota donated.\n'));
  assert.ok(md.includes('| cccc3333 | 1 | $0.00 | claude |'));
});

test('an empty ledger', () => {
  assert.equal(ledgerMarkdown({ totals: { tasks: 0, workers: 0, costUsd: 0 }, workers: [] }), 'No merged receipts yet.\n');
});
