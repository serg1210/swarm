// Coordination over plain git, for any forge or a bare repository on disk. Needs push access.
//
//   claims       refs/swarm/claims/<project>/<task>        created with a compare-and-swap push,
//                                                          so exactly one worker wins
//   submissions  refs/heads/swarm/<project>/<task>/<worker>
//   reviews      refs/swarm/reviews/<project>/<task>/<submitter>/<reviewer>
//
// Claims and reviews are commits on the empty tree whose message is a JSON document.
import { run } from '../util.mjs';
import { git } from '../verify.mjs';

const CLAIMS = 'refs/swarm/claims';
const REVIEWS = 'refs/swarm/reviews';

export class GitBoard {
  kind = 'git';
  unpublished = new Set(); // every task file is claimable; there is nothing to publish first

  constructor({ mirror, identity }) {
    this.mirror = mirror;
    this.identity = identity;
  }

  async #docCommit(doc) {
    const tree = (await git(this.mirror.dir, ['mktree'], { input: '' })).trim();
    const env = { ...process.env, GIT_AUTHOR_NAME: 'swarm', GIT_AUTHOR_EMAIL: 'swarm@invalid', GIT_COMMITTER_NAME: 'swarm', GIT_COMMITTER_EMAIL: 'swarm@invalid' };
    return (await git(this.mirror.dir, ['commit-tree', tree, '-m', JSON.stringify(doc)], { env })).trim();
  }

  async #readDocs(prefix) {
    const dir = this.mirror.dir;
    await git(dir, ['fetch', '--quiet', '--prune', 'origin', `+${prefix}/*:${prefix}/*`]);
    const out = await git(dir, ['for-each-ref', '--format=%(refname) %(objectname)', prefix]);
    const docs = [];
    for (const line of out.split('\n').filter(Boolean)) {
      const [ref, sha] = line.split(' ');
      try {
        docs.push({ ref, sha, doc: JSON.parse(await git(dir, ['log', '-1', '--format=%B', sha])) });
      } catch {
        /* not one of ours */
      }
    }
    return docs;
  }

  /** Map of task ref -> live claims. */
  async claims() {
    const live = new Map();
    for (const { ref, sha, doc } of await this.#readDocs(CLAIMS)) {
      if (new Date(doc.exp) < new Date()) continue;
      const list = live.get(doc.task) || [];
      list.push({ worker: doc.worker, exp: doc.exp, ref, sha, mine: doc.worker === this.identity?.id });
      live.set(doc.task, list);
    }
    for (const s of await this.submissions()) {
      const list = live.get(s.taskRef) || [];
      if (!list.some((c) => c.worker.startsWith(s.worker))) list.push({ worker: s.worker, submitted: true });
      live.set(s.taskRef, list);
    }
    return live;
  }

  async claim({ project, task }) {
    const ref = `${CLAIMS}/${task.ref}`;
    const exp = new Date(Date.now() + project.claimTtlMinutes * 60_000).toISOString();
    const sha = await this.#docCommit({ task: task.ref, worker: this.identity.id, exp });
    const existing = (await this.#readDocs(CLAIMS)).find((d) => d.ref === ref);
    if (existing && new Date(existing.doc.exp) > new Date()) return null;
    // Empty expected value means "the ref must not exist"; otherwise swap out the expired claim.
    const lease = `--force-with-lease=${ref}:${existing ? existing.sha : ''}`;
    const res = await run('git', ['push', '--quiet', lease, 'origin', `${sha}:${ref}`], { cwd: this.mirror.dir });
    return res.code === 0 ? { ref, sha } : null;
  }

  async release(handle) {
    if (!handle) return;
    await run('git', ['push', '--quiet', `--force-with-lease=${handle.ref}:${handle.sha}`, 'origin', `:${handle.ref}`], { cwd: this.mirror.dir });
  }

  /** Can work done here be submitted? A push that sends nothing answers it. See GitHubBoard.access. */
  async access() {
    const res = await run('git', ['push', '--dry-run', '--quiet', 'origin', `${this.mirror.base}:refs/heads/swarm/access-check`], {
      cwd: this.mirror.dir,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeoutMs: 60_000,
    });
    return res.code === 0 ? { ok: true, route: 'direct' } : { ok: false, reason: `the project's git remote refused a push (${(res.stderr || '').trim().split('\n')[0] || 'no reason given'})` };
  }

  branchFor(task) {
    return `swarm/${task.ref}/${this.identity.id.slice(0, 8)}`;
  }

  async submit({ workDir, branch, claim }) {
    await git(workDir, ['push', '--quiet', '--force', 'origin', `${branch}:refs/heads/${branch}`]);
    await this.release(claim);
    return { id: branch, where: `branch ${branch}` };
  }

  async submissions() {
    const out = await git(this.mirror.dir, ['ls-remote', 'origin', 'refs/heads/swarm/*']);
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [head, ref] = line.split('\t');
        const branch = ref.replace('refs/heads/', '');
        const [, project, task, worker] = branch.split('/');
        return { id: branch, taskRef: `${project}/${task}`, worker, head, mine: Boolean(this.identity?.id.startsWith(worker)) };
      });
  }

  /** Make the submission's commits available in the mirror; returns the head sha. */
  async fetchSubmission(sub) {
    await git(this.mirror.dir, ['fetch', '--quiet', 'origin', `refs/heads/${sub.id}`]);
    return sub.head;
  }

  async postReview(sub, review) {
    const sha = await this.#docCommit(review);
    const ref = `${REVIEWS}/${sub.taskRef}/${sub.worker}/${this.identity.id.slice(0, 8)}`;
    await git(this.mirror.dir, ['push', '--quiet', '--force', 'origin', `${sha}:${ref}`]);
    return { where: ref };
  }

  async reviews(sub) {
    const prefix = `${REVIEWS}/${sub.taskRef}/${sub.worker}/`;
    return (await this.#readDocs(REVIEWS)).filter((d) => d.ref.startsWith(prefix)).map((d) => d.doc);
  }

  async merge(sub) {
    const dir = this.mirror.dir;
    const branch = this.mirror.branch;
    await git(dir, ['fetch', '--quiet', 'origin', branch, `refs/heads/${sub.id}`]);
    await git(dir, ['checkout', '--quiet', '--detach', `origin/${branch}`]);
    await git(dir, ['merge', '--quiet', '--no-ff', '-m', `Merge swarm submission ${sub.id}`, sub.head]);
    await git(dir, ['push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`]);
    // Leave no refs behind: the work is in the default branch now, the receipt is the record.
    const stale = [`:refs/heads/${sub.id}`];
    const reviews = await git(dir, ['ls-remote', 'origin', `${REVIEWS}/${sub.taskRef}/${sub.worker}/*`]);
    for (const line of reviews.split('\n').filter(Boolean)) stale.push(`:${line.split('\t')[1]}`);
    await run('git', ['push', '--quiet', 'origin', ...stale], { cwd: dir });
    return { where: branch };
  }
}
