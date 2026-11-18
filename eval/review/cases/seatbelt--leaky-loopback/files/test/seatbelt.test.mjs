import test from 'node:test';
import assert from 'node:assert/strict';
import { seatbeltProfile } from '../src/seatbelt.mjs';

test('starts permissive, then confines writes to the work directory', () => {
  const lines = seatbeltProfile({ workDir: '/tmp/work dir' }).split('\n');
  assert.deepEqual(lines.slice(0, 2), ['(version 1)', '(allow default)']);
  assert.ok(lines.indexOf('(deny file-write*)') < lines.indexOf('(allow file-write* (subpath "/tmp/work dir"))'));
});

test('network is denied by default, then loopback is allowed back', () => {
  const lines = seatbeltProfile({ workDir: '/w' }).split('\n');
  const deny = lines.indexOf('(deny network*)');
  assert.ok(deny > 0);
  assert.ok(lines.indexOf('(allow network* (local ip "localhost:*"))') > deny);
});

test('with network on there are no network rules', () => {
  assert.ok(!seatbeltProfile({ workDir: '/w', network: true }).includes('network'));
});
