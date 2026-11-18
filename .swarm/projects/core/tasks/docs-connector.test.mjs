import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../../../../src/mcp.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const doc = fs.readFileSync(path.join(root, 'docs', 'CONNECTOR.md'), 'utf8');

test('has the required sections, in order', () => {
  const at = ['## Setup', '## Delegate mode', '## Connector mode', '## What the file tools refuse'].map((h) => doc.split('\n').indexOf(h));
  assert.ok(at.every((i) => i >= 0), 'a required heading is missing');
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test('names every tool the connector exposes, and no tool that does not exist', () => {
  const names = TOOLS.map((t) => t.name);
  for (const name of names) assert.ok(doc.includes('`' + name + '`'), `missing ${name}`);
  for (const [, mentioned] of doc.matchAll(/`(swarm_[a-z_]+)`/g)) assert.ok(names.includes(mentioned), `${mentioned} is not a tool`);
});

test('shows how to start it and stays within length', () => {
  assert.ok(doc.includes('swarm mcp'));
  const words = doc.split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 300 && words <= 900, `${words} words`);
});
