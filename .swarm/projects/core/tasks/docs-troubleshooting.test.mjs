import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const doc = fs.readFileSync(path.join(root, 'docs', 'TROUBLESHOOTING.md'), 'utf8');
const source = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter((f) => String(f).endsWith('.mjs')).map((f) => fs.readFileSync(path.join(root, 'src', String(f)), 'utf8')).join('\n');

const MESSAGES = ['No sandbox available', 'bubblewrap is installed but cannot build a sandbox', 'is not open', 'the change is empty', 'gh logged in'];

test('quotes each message exactly as the code prints it', () => {
  for (const message of MESSAGES) {
    assert.ok(source.includes(message), `the code no longer prints "${message}"; update the task`);
    assert.ok(new RegExp('`[^`\\n]*' + message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^`\\n]*`').test(doc), `"${message}" is not quoted in backticks`);
  }
});

test('one section per message, with a fix in each, within length', () => {
  const sections = doc.split(/^## /m).slice(1);
  assert.ok(sections.length >= 5, `${sections.length} sections`);
  for (const section of sections) assert.ok(section.includes('`'), `section "${section.split('\n')[0]}" names no command, setting or message`);
  const words = doc.split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 300 && words <= 900, `${words} words`);
});
