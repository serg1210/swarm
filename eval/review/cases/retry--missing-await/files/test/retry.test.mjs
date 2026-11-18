import test from 'node:test';
import assert from 'node:assert/strict';
import { retry } from '../src/retry.mjs';

test('returns the first success and passes the attempt number', async () => {
  const seen = [];
  const result = await retry((attempt) => {
    seen.push(attempt);
    if (attempt < 2) throw new Error(`fail ${attempt}`);
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.deepEqual(seen, [0, 1, 2]);
});

test('works with an asynchronous function', async () => {
  assert.equal(await retry(async (attempt) => `done ${attempt}`), 'done 0');
});

test('rejects with the last error after the last attempt', async () => {
  let calls = 0;
  await assert.rejects(
    retry(() => { throw new Error(`fail ${calls++}`); }, { attempts: 2 }),
    /fail 1/,
  );
  assert.equal(calls, 2);
});

test('one attempt means no retry', async () => {
  let calls = 0;
  await assert.rejects(retry(() => { calls++; throw new Error('no'); }, { attempts: 1 }), /no/);
  assert.equal(calls, 1);
});
