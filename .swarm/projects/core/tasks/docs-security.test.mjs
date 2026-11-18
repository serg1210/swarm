import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const doc = fs.readFileSync(path.join(root, 'docs', 'SECURITY.md'), 'utf8');
const section = (heading) => {
  const parts = doc.split(/^## /m).map((s) => ({ title: s.split('\n')[0].trim(), text: s }));
  return parts.find((p) => p.title === heading)?.text || '';
};

test('has the three sections, in order', () => {
  const lines = doc.split('\n');
  const at = ['## What Swarm protects against', '## What it does not protect against', '## Reporting a vulnerability'].map((h) => lines.indexOf(h));
  assert.ok(at.every((i) => i >= 0), 'a required heading is missing');
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test('the protections are named', () => {
  const text = section('What Swarm protects against').toLowerCase();
  for (const term of ['seatbelt', 'bubblewrap', 'docker', 'ed25519', 'base branch']) assert.ok(text.includes(term), `missing ${term}`);
});

test('the limits are as concrete as the protections', () => {
  const limits = section('What it does not protect against');
  for (const term of ['prompt injection', 'shell']) assert.ok(limits.toLowerCase().includes(term), `missing ${term}`);
  const words = (s) => s.split(/\s+/).filter(Boolean).length;
  assert.ok(words(limits) >= 120, `${words(limits)} words on limits`);
  assert.ok(section('Reporting a vulnerability').toLowerCase().includes('advisor'));
  const total = words(doc);
  assert.ok(total >= 350 && total <= 900, `${total} words`);
});
