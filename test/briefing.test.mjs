import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBriefing, jobProgress, shortTitle } from '../src/briefing.mjs';

const now = new Date('2026-11-18T00:00:00Z');
const registry = [
  { repo: 'acme/tools', project: 'core', name: 'Acme core', description: 'The command-line tool.', languages: ['JavaScript'] },
  { repo: 'acme/tools', project: 'docs', name: 'Acme docs', description: 'Guides and reference.', languages: ['Markdown'] },
  { repo: 'other/lib', project: 'main', name: 'Other lib', description: 'A parsing library.', languages: ['Rust'] },
];
const row = (project, id, size, state = 'open') => ({ project, projectName: project, projectDescription: '', ref: `${project}/${id}`, title: `Do ${id}`, size, state });
const tasksByRepo = {
  'acme/tools': [row('core', 'big', 'M'), row('core', 'small', 'S'), row('core', 'taken', 'S', 'claimed'), row('docs', 'guide', 'S')],
  'other/lib': { error: 'could not reach other/lib' },
};
const rateLimit = { status: 'allowed', weekly: { utilization: 0.6, resetsAt: '2026-11-21T00:00:00Z' }, fiveHour: { utilization: 0.49, resetsAt: '2026-11-18T04:00:00Z' } };

test('says how much quota is left, what Swarm may use, and what it will do next', () => {
  const b = buildBriefing({ rateLimit, decision: { go: true, reason: 'within your limits' }, reserve: 0.2, registry, chosen: ['acme/tools#core'], tasksByRepo, now });
  assert.deepEqual({ used: b.quota.weekly.usedPct, left: b.quota.weekly.leftPct, swarm: b.quota.weekly.swarmCanUsePct }, { used: 60, left: 40, swarm: 20 });
  assert.equal(b.quota.fiveHour.leftPct, 51);
  assert.equal(b.quota.weekly.resetsIn, '3d 0h');
  assert.equal(b.quota.headline, '40% left this week. Swarm uses 20%.');
  // The smallest open task of the chosen project, never a claimed one.
  assert.deepEqual(b.next, { project: 'acme/tools#core', projectName: 'Acme core', task: 'core/small', title: 'Do small', size: 'S', sizeWord: 'small' });
  assert.equal(b.plan, 'Acme core: Do small');
  // The run as a checklist: where the quota stands, which project, which task, then what happens.
  assert.deepEqual(b.steps, ['Quota: 40% left, Swarm uses 20%', 'Project: Acme core', 'Claim task: Do small', 'Agent writes the change', 'Checks run in sandbox', 'Pull request opens']);
  // Blunt on purpose: seven words a line at most.
  for (const line of [...b.steps, ...b.text]) assert.ok(line.split(/\s+/).length <= 7, line);
});

test('long task titles are cut to a few words', () => {
  assert.equal(shortTitle('Add a README badge showing a project\'s verified task count'), 'Add a README badge showing…');
  assert.equal(shortTitle('Add `swarm lint` now'), 'Add swarm lint now');
  const b = buildBriefing({ registry, chosen: ['acme/tools#core'], tasksByRepo: { 'acme/tools': [{ ...row('core', 'x', 'S'), title: 'Write the troubleshooting guide for the messages people actually hit' }] }, now });
  assert.equal(b.steps[2], 'Claim task: Write the troubleshooting guide for…');
  for (const line of b.steps) assert.ok(line.split(/\s+/).length <= 7, line);
});

test('a running job says which step it is on, in a few words', () => {
  const log = ['› Syncing acme/tools', '› Checking your quota', '  5-hour: 21% used; weekly: 39% used'];
  assert.deepEqual(jobProgress(''), { step: 0, now: 'Starting', done: false });
  assert.deepEqual(jobProgress(log.join('\n')), { step: 1, now: 'Checking quota', done: false });
  log.push('› Claiming core/small: Do small');
  assert.deepEqual(jobProgress(log.join('\n')), { step: 3, now: 'Claiming core/small', done: false });
  log.push('› Agent claude working (attempt 1/2, budget $3.00)');
  assert.deepEqual(jobProgress(log.join('\n')), { step: 4, now: 'Agent claude writing, attempt 1', done: false });
  log.push('› Verifying in seatbelt sandbox');
  assert.equal(jobProgress(log.join('\n')).now, 'Running checks in sandbox');
  log.push('›   unit-tests: node --test test/*.test.mjs');
  assert.deepEqual(jobProgress(log.join('\n')), { step: 5, now: 'Running check: unit-tests', done: false });
  log.push('✗ Verify step "unit-tests" (node --test) exited 1.', '› Agent claude working (attempt 2/2, budget $3.00)');
  const retry = jobProgress(log.join('\n'));
  assert.equal(retry.now, 'Agent claude writing, attempt 2');
  assert.match(retry.problem, /^Verify step "unit-tests"/);
  log.push('› Verifying in seatbelt sandbox', '✓ Verified: unit-tests (2 files, 30 lines)');
  assert.deepEqual(jobProgress(log.join('\n')), { step: 6, now: 'Opening pull request', done: false });
  log.push('✓ Submitted core/small → https://github.com/acme/tools/pull/9  ($0.08 API-equivalent, 40s)');
  assert.deepEqual(jobProgress(log.join('\n')), { step: 6, now: 'Pull request opened', done: true, pullRequest: 'https://github.com/acme/tools/pull/9' });
  assert.deepEqual(jobProgress('› Checking your quota\n! Not donating now: weekly quota is 85% used. Use --force to override.'), { step: 1, now: 'Reserve reached, nothing spent', done: true });
  for (const l of [1, 3, 4, 6, 8, 9, 10]) assert.ok(jobProgress(log.slice(0, l).join('\n')).now.split(' ').length <= 7);
});

test('lists every project with enough to choose from, the chosen one first', () => {
  const b = buildBriefing({ rateLimit, decision: { go: true }, registry, chosen: ['acme/tools#core'], tasksByRepo, now });
  assert.deepEqual(b.projects.map((p) => [p.id, p.chosen, p.openTasks]), [
    ['acme/tools#core', true, 2],
    ['acme/tools#docs', false, 1],
    ['other/lib#main', false, null],
  ]);
  assert.equal(b.projects[0].url, 'https://github.com/acme/tools');
  assert.deepEqual(b.projects[0].examples, ['Do small', 'Do big']);
  assert.equal(b.projects[2].unreachable, 'could not reach other/lib');
  const docs = b.choices.find((c) => c.id === 'acme/tools#docs');
  assert.equal(docs.label, 'Acme docs');
  assert.equal(docs.description, 'Guides and reference. 1 open. E.g. "Do guide".');
  assert.equal(docs.current, false);
  assert.ok(b.choices.every((c) => c.label.length <= 28 && c.description.length <= 220));
  assert.ok(b.text.includes('Also open: Acme docs (1)'));
  assert.ok(!JSON.stringify(b).includes('_open'));
});

test('a whole repository can be chosen, and the default is said to be the default', () => {
  const b = buildBriefing({ registry, chosen: ['acme/tools'], usingDefault: true, tasksByRepo, now });
  assert.deepEqual(b.projects.filter((p) => p.chosen).map((p) => p.id), ['acme/tools#core', 'acme/tools#docs']);
  assert.equal(b.usingDefault, true);
});

test('when the reserve is reached nothing is spent, and it says why', () => {
  const b = buildBriefing({ rateLimit: { weekly: { utilization: 0.85 } }, decision: { go: false, reason: 'weekly quota is 85% used' }, registry, chosen: ['acme/tools#core'], tasksByRepo, now });
  assert.equal(b.quota.go, false);
  assert.equal(b.quota.weekly.swarmCanUsePct, 0);
  assert.equal(b.quota.headline, 'Reserve reached: 85% used. Nothing spent.');
  assert.equal(b.plan, 'Nothing spent.');
  assert.deepEqual(b.steps, ['Quota: 85% used, reserve reached', 'Nothing spent']);
});

test('unknown quota is stated, not guessed', () => {
  const cloud = buildBriefing({ cloud: true, registry, chosen: ['acme/tools#core'], tasksByRepo, now });
  assert.equal(cloud.quota.known, false);
  assert.equal(cloud.quota.headline, 'Quota unknown in the cloud.');
  assert.equal(cloud.steps[0], 'Quota: unknown here');
  assert.equal(cloud.quota.weekly, undefined);
  assert.match(buildBriefing({ registry, chosen: [], tasksByRepo: {}, now }).quota.headline, /^Quota unknown here\./);
});

test('nothing open in the chosen project: suggests one that has work', () => {
  const b = buildBriefing({ rateLimit, decision: { go: true }, registry, chosen: ['acme/tools#core'], tasksByRepo: { 'acme/tools': [row('core', 'taken', 'S', 'claimed'), row('docs', 'guide', 'S')] }, now });
  assert.equal(b.next, null);
  assert.deepEqual(b.suggestion, { project: 'acme/tools#docs', name: 'Acme docs', reason: 'Nothing open in your project. Acme docs has 1.' });
  assert.equal(b.plan, b.suggestion.reason);
  assert.deepEqual(b.steps, ['Quota: 40% left, Swarm uses 20%', 'Nothing open, nothing spent']);
});

test('a project that is not in the registry still shows up once chosen', () => {
  const b = buildBriefing({ registry: [], chosen: ['me/thing#app'], tasksByRepo: { 'me/thing': [{ project: 'app', projectName: 'My app', projectDescription: 'An app.', ref: 'app/x', title: 'Do x', size: 'L', state: 'open' }] }, now });
  assert.deepEqual(b.projects.map((p) => [p.id, p.name, p.description, p.chosen]), [['me/thing#app', 'My app', 'An app.', true]]);
  assert.equal(b.next.sizeWord, 'large');
});
