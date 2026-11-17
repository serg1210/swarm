import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredQuorum } from '../src/quorum.mjs';

const project = (review) => ({ id: 'p', review });

test('base quorum when there are no tiers or no matching files', () => {
  assert.equal(requiredQuorum(project({ quorum: 1 }), ['src/a.mjs']), 1);
  assert.equal(requiredQuorum(project({ quorum: 2, tiers: [] }), []), 2);
  assert.equal(requiredQuorum(project({ quorum: 1, tiers: [{ paths: ['src/board/**'], quorum: 3 }] }), ['docs/x.md']), 1);
});

test('the highest matching tier wins, and tiers never lower the base', () => {
  const p = project({ quorum: 2, tiers: [{ paths: ['src/board/**', 'src/worker.mjs'], quorum: 3 }, { paths: ['docs/**'], quorum: 1 }, { paths: ['src/**'], quorum: 4 }] });
  assert.equal(requiredQuorum(p, ['docs/x.md']), 2);
  assert.equal(requiredQuorum(p, ['src/worker.mjs']), 4);
  assert.equal(requiredQuorum(project({ quorum: 1, tiers: [{ paths: ['src/board/**'], quorum: 3 }] }), ['README.md', 'src/board/git.mjs']), 3);
});

test('malformed tiers are ignored', () => {
  const p = project({ quorum: 1, tiers: [{ paths: ['src/**'] }, { quorum: 5 }, { paths: ['src/**'], quorum: 'many' }, null] });
  assert.equal(requiredQuorum(p, ['src/a.mjs']), 1);
});
