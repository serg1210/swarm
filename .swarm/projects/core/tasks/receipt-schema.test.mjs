import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'receipt.schema.json'), 'utf8'));
const receipts = fs
  .readdirSync(path.join(root, '.swarm', 'receipts'), { recursive: true })
  .filter((f) => String(f).endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(root, '.swarm', 'receipts', String(f)), 'utf8')));

const described = (props, where) => {
  for (const [key, prop] of Object.entries(props)) {
    assert.ok(prop.type, `${where}.${key} has no type`);
    assert.ok(typeof prop.description === 'string' && prop.description.trim().length >= 10, `${where}.${key} has no description`);
  }
};

test('is a described JSON Schema for an object', () => {
  assert.match(schema.$schema, /json-schema\.org\/draft\/2020-12/);
  assert.equal(schema.type, 'object');
  assert.ok(schema.title && schema.description);
  for (const key of ['v', 'kind', 'project', 'task', 'base', 'work', 'tree', 'diffSha256', 'agent', 'usage', 'verify', 'ts', 'signer', 'sig']) {
    assert.ok(schema.required.includes(key), `${key} is not required`);
  }
  described(schema.properties, 'receipt');
  for (const nested of ['agent', 'usage', 'signer']) {
    assert.equal(schema.properties[nested].type, 'object');
    described(schema.properties[nested].properties, nested);
  }
  for (const key of ['id', 'handle', 'publicKey']) assert.ok(schema.properties.signer.required.includes(key));
});

test('covers every merged receipt', () => {
  assert.ok(receipts.length >= 3);
  for (const receipt of receipts) {
    for (const key of Object.keys(receipt)) assert.ok(key in schema.properties, `receipt field ${key} is not in the schema`);
    for (const key of schema.required) assert.ok(key in receipt, `required field ${key} is missing from a merged receipt`);
    for (const nested of ['agent', 'usage', 'signer']) {
      for (const key of Object.keys(receipt[nested] || {})) assert.ok(key in schema.properties[nested].properties, `${nested}.${key} is not in the schema`);
    }
  }
});
