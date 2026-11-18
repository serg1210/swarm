import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'bin', 'swarm.mjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-doctor-json-'));
const doctor = (args) => spawnSync(process.execPath, [BIN, 'doctor', ...args], { env: { ...process.env, SWARM_HOME: home }, encoding: 'utf8' });

test('one JSON document on stdout, matching the exit code', () => {
  const r = doctor(['--json']);
  const out = JSON.parse(r.stdout);
  assert.equal(typeof out.ok, 'boolean');
  assert.ok(Array.isArray(out.checks) && out.checks.length >= 5);
  for (const check of out.checks) {
    assert.equal(typeof check.ok, 'boolean');
    assert.equal(typeof check.label, 'string');
    assert.equal(typeof check.detail, 'string');
    assert.ok(!/\u001b\[/.test(check.label + check.detail), 'no colour codes');
  }
  const labels = out.checks.map((c) => c.label);
  assert.ok(labels[0].startsWith('node '));
  assert.ok(labels.includes('git'));
  assert.ok(labels.some((l) => l.startsWith('sandbox')));
  assert.ok(labels.some((l) => l.startsWith('identity')));
  assert.equal(r.status, out.ok ? 0 : 1);
  if (!out.ok) assert.ok(out.checks.some((c) => !c.ok));
});

test('the text output is still there without --json', () => {
  const r = doctor([]);
  assert.match(r.stdout + r.stderr, /[✓✗] node /);
  assert.throws(() => JSON.parse(r.stdout));
});
