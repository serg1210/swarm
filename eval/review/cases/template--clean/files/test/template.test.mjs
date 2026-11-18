import test from 'node:test';
import assert from 'node:assert/strict';
import { readTemplate } from '../src/template.mjs';

test('reads a template by name', () => {
  assert.equal(readTemplate('welcome'), 'Welcome, {{name}}!\n');
});

test('a missing template throws and names it', () => {
  assert.throws(() => readTemplate('no-such-template'), /no-such-template/);
});

test('anything but a plain name is rejected', () => {
  for (const name of ['../secret', '/etc/passwd', 'a/b', 'welcome/../../secret', '..\\x', '.hidden', 'a.b', 'a b', '', null, 42]) {
    assert.throws(() => readTemplate(name), /Invalid template name/, String(name));
  }
});
