import test from 'node:test';
import assert from 'node:assert/strict';
import { taskTemplate } from '../../../../src/task-template.mjs';
import { parseFrontmatter } from '../../../../src/util.mjs';

test('round-trips through the frontmatter parser', () => {
  const text = taskTemplate({ title: '  Add a thing  ', size: 'M', paths: ['src/a.mjs', 'test/**'], verify: ['node --test test/a.test.mjs'] });
  assert.ok(text.startsWith('---\n'));
  const { meta, body } = parseFrontmatter(text);
  assert.equal(meta.title, 'Add a thing');
  assert.equal(meta.size, 'M');
  assert.deepEqual(meta.paths, ['src/a.mjs', 'test/**']);
  assert.deepEqual(meta.verify, ['node --test test/a.test.mjs']);
  assert.match(body, /^## Goal\n.+/m);
  assert.match(body, /^## Acceptance\n.+/m);
  assert.ok(body.indexOf('## Goal') < body.indexOf('## Acceptance'));
});

test('awkward titles come back as the same string', () => {
  for (const title of ['42', 'true', 'null', 'Fix: the "thing"', '[draft] cleanup', '{maybe}', '"quoted"', "it's fine", '# not a comment']) {
    const { meta } = parseFrontmatter(taskTemplate({ title }));
    assert.strictEqual(meta.title, title, `title ${title}`);
  }
});

test('defaults', () => {
  const { meta } = parseFrontmatter(taskTemplate({ title: 'x' }));
  assert.equal(meta.size, 'S');
  assert.deepEqual(meta.paths, []);
  assert.ok(!('verify' in meta));
  assert.ok(!('verify' in parseFrontmatter(taskTemplate({ title: 'x', verify: [] })).meta));
});

test('bad input', () => {
  assert.throws(() => taskTemplate({ title: '   ' }), TypeError);
  assert.throws(() => taskTemplate({}), TypeError);
  assert.throws(() => taskTemplate({ title: 'two\nlines' }), TypeError);
  assert.throws(() => taskTemplate({ title: 'x', size: 'XL' }), RangeError);
});
