// The GitHub board's handling of rejected submissions, against an in-memory stand-in for the
// REST API: who can close a submission, when its task is offered again, and when it is parked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { GitHubBoard } from '../src/board/github.mjs';
import { fingerprint, signDoc } from '../src/identity.mjs';
import { withdrawIfRejected } from '../src/merge.mjs';
import { openTasks } from '../src/worker.mjs';
import { setProgressSink } from '../src/util.mjs';

setProgressSink(() => {}); // the pass reports each closure; keep that out of the test output

function identity(handle) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { handle, publicKey: pub, privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), id: fingerprint(pub) };
}

const task = { id: 'x', ref: 'core/x', title: 'T', body: 'B', paths: ['src/**'], verify: [], status: 'ready' };
const project = { id: 'core', verify: [], replication: 1, claimTtlMinutes: 90, review: { quorum: 1, maxRejections: 2 }, tasks: [task] };

/** One fake repository. `as(identity, association, canPush)` is a board acting as that account. */
function fakeGitHub() {
  const gh = { issues: [], comments: new Map(), pulls: [], next: 1, clock: Date.now() - 30 * 60_000 };
  const add = (title, association, extra = {}) => {
    const n = { number: gh.next++, title, author_association: association, user: { login: association, type: 'User' }, html_url: 'issue', state: 'open', ...extra };
    gh.issues.push(n);
    gh.comments.set(n.number, []);
    return n;
  };
  const api = (association, canPush) => async (method, endpoint, body) => {
    let m;
    if (endpoint === 'repos/o/r') return { permissions: { push: canPush } };
    if (method === 'GET' && endpoint.startsWith('repos/o/r/issues?')) return gh.issues.filter((i) => i.state === 'open').map((i) => ({ ...i, comments: gh.comments.get(i.number).length }));
    if ((m = /^repos\/o\/r\/issues\/(\d+)\/comments/.exec(endpoint))) {
      const list = gh.comments.get(Number(m[1]));
      if (method === 'GET') return list;
      const comment = { id: gh.next++, body: body.body, created_at: new Date((gh.clock += 60_000)).toISOString(), author_association: association, user: { login: association, type: 'User' }, html_url: 'comment' };
      list.push(comment);
      return comment;
    }
    if (method === 'GET' && endpoint.startsWith('repos/o/r/pulls?')) return gh.pulls.filter((p) => p.state === 'open');
    if (method === 'PATCH' && (m = /^repos\/o\/r\/pulls\/(\d+)$/.exec(endpoint))) {
      const pr = gh.pulls.find((p) => p.number === Number(m[1]));
      pr.state = body.state;
      gh.issues.find((i) => i.number === pr.number).state = body.state;
      return pr;
    }
    throw new Error(`unexpected ${method} ${endpoint}`);
  };
  add('[swarm] core/x: T', 'OWNER');
  return {
    gh,
    as(id, association, canPush) {
      const board = new GitHubBoard({ repo: 'o/r', mirror: { projects: [project], branch: 'main', dir: '/nonexistent' }, identity: id });
      board.api = api(association, canPush);
      return board;
    },
    /** What a worker's submission looks like: a pull request from a fork, with a signed receipt. */
    submit(worker, work) {
      const n = add('[swarm] core/x: T', 'NONE', { pull_request: {} });
      gh.pulls.push({ number: n.number, html_url: 'pr', state: 'open', title: n.title, body: `<!-- swarm:worker ${worker.id} -->`, head: { sha: `${work}-receipt`, ref: 'swarm/core/x/w', repo: { full_name: 'fork/r' } }, user: { login: 'w' } });
      return signDoc({ v: 1, kind: 'receipt', project: 'core', task: 'x', work }, worker);
    },
  };
}

const review = (receipt, verdict, by) => signDoc({ v: 1, kind: 'review', work: receipt.work, verdict, notes: 'n', agent: { runner: 'mock', model: 'm' }, ts: new Date().toISOString() }, by);
const state = async (board) => openTasks([project], '/nonexistent', await board.claims([project]), { unpublished: board.unpublished, rejected: board.rejected })[0].state;

test('github: only a rejection from an account with push access closes a submission', async () => {
  const [maintainer, worker, stranger] = ['m', 'w', 's'].map(identity);
  const hub = fakeGitHub();
  const m = hub.as(maintainer, 'OWNER', true);
  const s = hub.as(stranger, 'NONE', false);
  assert.ok(await hub.as(worker, 'NONE', false).claim({ project, task }));
  const receipt = hub.submit(worker, 'w1');
  const [sub] = await m.submissions();

  // A stranger signs a rejection, and forges the markers a maintainer would write. Nothing closes.
  await s.postReview(sub, review(receipt, 'reject', stranger));
  assert.deepEqual(await withdrawIfRejected({ board: m }, sub, { receipt, project }), { withdrawn: false });
  assert.equal(await s.withdraw(sub), null);
  await assert.rejects(s.reopen(task), /needs push access/);
  assert.equal(hub.gh.pulls[0].state, 'open');
  assert.equal(await state(m), 'claimed');

  // The maintainer's own rejection closes it, and the task is open at once: the submitter's
  // claim, still inside its 90 minutes, does not hold it.
  await m.postReview(sub, review(receipt, 'reject', maintainer));
  const out = await withdrawIfRejected({ board: m }, sub, { receipt, project });
  assert.deepEqual(out, { withdrawn: true, rejections: 1, stuck: false });
  assert.equal(hub.gh.pulls[0].state, 'closed');
  assert.equal(await state(m), 'open');
  assert.deepEqual(m.hints('core/x'), { failures: { review: 1 } });

  // Withdrawing the same work again is not a second rejection.
  assert.equal((await m.withdraw(sub, { worker: worker.id, work: 'w1' })).rejections, 1);
});

test('github: a task is parked at review.maxRejections and a maintainer reopens it', async () => {
  const [maintainer, worker] = ['m', 'w'].map(identity);
  const hub = fakeGitHub();
  const m = hub.as(maintainer, 'OWNER', true);
  let out;
  for (const work of ['w1', 'w2']) {
    const receipt = hub.submit(worker, work);
    const sub = (await m.submissions()).at(-1);
    await m.postReview(sub, review(receipt, 'reject', maintainer));
    out = await withdrawIfRejected({ board: m }, sub, { receipt, project });
  }
  assert.deepEqual(out, { withdrawn: true, rejections: 2, stuck: true });
  assert.equal(await state(m), 'stuck');
  await m.reopen(task);
  assert.equal(await state(m), 'open');
});
