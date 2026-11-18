import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lintRepo } from '../src/lint.mjs';

test('lintRepo reports bad manifests and tasks, and is quiet on a missing .swarm', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-unit-'));
  assert.deepEqual(lintRepo(root), []);
  fs.mkdirSync(path.join(root, '.swarm/projects/p/tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarm/projects/p/project.json'), '{"name":"P","verify":[{"name":"t","run":"true"}],"bogus":1}');
  fs.writeFileSync(path.join(root, '.swarm/projects/p/tasks/ok.md'), '---\ntitle: T\n---\nBody\n');
  const problems = lintRepo(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0].problem, /bogus/);
});
