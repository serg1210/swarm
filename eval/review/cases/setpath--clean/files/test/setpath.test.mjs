import test from 'node:test';
import assert from 'node:assert/strict';
import { setPath } from '../src/setpath.mjs';

test('creates objects along the way and returns the object', () => {
  const obj = {};
  assert.equal(setPath(obj, 'a.b.c', 1), obj);
  assert.deepEqual(obj, { a: { b: { c: 1 } } });
});

test('keeps what is already there', () => {
  assert.deepEqual(setPath({ a: { x: 1 } }, 'a.y', 2), { a: { x: 1, y: 2 } });
  assert.deepEqual(setPath({ a: 1 }, 'a', 2), { a: 2 });
});

test('a value in the way that is not an object throws', () => {
  assert.throws(() => setPath({ a: 1 }, 'a.b', 2), /not an object/);
  assert.throws(() => setPath({ a: null }, 'a.b', 2), /not an object/);
});

test('forbidden segments throw anywhere in the path', () => {
  for (const path of ['__proto__.polluted', 'constructor.prototype.polluted', 'prototype.x', 'a.__proto__.polluted', 'a.b.constructor', 'a.prototype']) {
    assert.throws(() => setPath({}, path, true), /Forbidden segment/, path);
  }
  assert.equal({}.polluted, undefined);
});

test('an empty path or segment throws', () => {
  assert.throws(() => setPath({}, '', 1), /Empty segment/);
  assert.throws(() => setPath({}, 'a..b', 1), /Empty segment/);
});
