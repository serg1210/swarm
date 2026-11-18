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
  for (const rule of ['(allow network-bind (local ip "localhost:*"))', '(allow network-inbound (local ip "localhost:*"))', '(allow network-outbound (remote ip "localhost:*"))']) {
    assert.ok(lines.indexOf(rule) > deny, rule);
  }
  // Outbound is only ever allowed towards a loopback address.
  for (const line of lines) if (/allow network(\*|-outbound)/.test(line)) assert.match(line, /\(remote ip "localhost:\*"\)/);
});

test('with network on there are no network rules', () => {
  assert.ok(!seatbeltProfile({ workDir: '/w', network: true }).includes('network'));
});
