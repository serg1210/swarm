// Coordination over GitHub, through `gh api`. No server, no tokens handled by Swarm.
//
// Only GitHub's REST API is used. Claude Code cloud sessions reach GitHub through a proxy that
// rejects GraphQL, which rules out `gh pr`, `gh issue` and `gh repo view`; REST works both there
// and on a laptop, so there is one code path.
//
// Pull requests are expensive for maintainers, so they are reserved for work that already
// passed verification. Everything before that is an append-only log on one issue per task:
//
//   task issue   "[swarm] <project>/<task>: ..." opened by a maintainer (`swarm sync`). The task
//                file in the repository stays the source of truth; the issue is the log.
//   claim        a signed comment on that issue. GitHub orders comments, so the earliest live
//                claim wins. Claims expire; the clock is GitHub's comment timestamp.
//   release      a signed comment by the same worker, optionally naming the verify step that
//                failed. Later workers are told which checks tripped others up.
//   submission   a pull request, opened only after verification passed on the worker's machine
//   review       a pull request comment carrying a signed review document
//   reject       a signed comment on the task issue by someone with push access, written when a
//                rejected pull request is closed. The task opens again; after the project's
//                `review.maxRejections` of these it is parked until a maintainer posts `reopen`.
//
// Volunteers without push access work from their own fork.
import { must, run } from '../util.mjs';
import { signDoc, verifyDoc } from '../identity.mjs';
import { git } from '../verify.mjs';

const TITLE = /^\[swarm\] ([a-z0-9-]+)\/([a-z0-9-]+)/;
const MARK = /<!-- swarm:(claim|release|reject|reopen) ([A-Za-z0-9+/=]+) -->/;
const REVIEW_MARK = '<!-- swarm:review -->';
const WORKER_MARK = /<!-- swarm:worker ([0-9a-f]{16}) -->/;
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

const encode = (doc) => Buffer.from(JSON.stringify(doc)).toString('base64');

/** Was this issue or comment written by someone with push access, or by the repository's own Actions bot? */
const isTrusted = (n) => TRUSTED.has(n.author_association) || (n.user?.type === 'Bot' && n.user.login === 'github-actions[bot]');

/** Parse a claim or release marker out of a comment body. Returns a verified doc or null. */
export function parseMarker(body, taskRef) {
  const m = MARK.exec(body || '');
  if (!m) return null;
  try {
    const doc = JSON.parse(Buffer.from(m[2], 'base64').toString('utf8'));
    if (doc.kind !== m[1] || doc.task !== taskRef || !verifyDoc(doc).ok) return null;
    return doc;
  } catch {
    return null;
  }
}

/**
 * Replay a task issue's comments, oldest first.
 * Returns the live claims in winning order, how often each verify step failed before, and how
 * many submissions were rejected in review since the task was last reopened.
 * Only signed markers count, and a worker can release only its own claim. `reject` and `reopen`
 * count only in a comment marked `trusted` (written by someone with push access): anyone can
 * sign a marker, and these two decide whether a task is still offered to workers.
 */
export function resolveClaims(comments, { taskRef, ttlMinutes, now = Date.now(), knownSteps = [] }) {
  let live = [];
  const failures = {};
  let rejected = new Set(); // work commits, so one submission is never counted twice
  const steps = new Set([...knownSteps, 'policy', 'agent']);
  for (const c of comments) {
    const doc = parseMarker(c.body, taskRef);
    if (!doc) continue;
    const worker = doc.signer.id;
    if (doc.kind === 'claim') {
      const exp = new Date(c.createdAt).getTime() + ttlMinutes * 60_000;
      live = live.filter((x) => x.worker !== worker);
      if (exp > now) live.push({ worker, commentId: c.id, exp: new Date(exp).toISOString() });
    } else if (doc.kind === 'release') {
      live = live.filter((x) => x.worker !== worker);
      // The step name is fed to other workers' agents, so it must be one we already know.
      if (steps.has(doc.failedStep)) failures[doc.failedStep] = (failures[doc.failedStep] || 0) + 1;
    } else if (doc.kind === 'reject' && c.trusted) {
      if (typeof doc.work === 'string') rejected.add(doc.work);
      // A worker's claim is not released when it submits, so it would otherwise hold the task
      // until it lapsed, long after the submission it stood for was closed.
      live = live.filter((x) => x.worker !== doc.worker);
    } else if (doc.kind === 'reopen' && c.trusted) {
      rejected = new Set();
    }
  }
  if (rejected.size) failures.review = rejected.size;
  return { live, failures, rejections: rejected.size };
}

const CLOUD = process.env.CLAUDE_CODE_REMOTE === 'true';

export class GitHubBoard {
  kind = 'github';
  unpublished = new Set();
  rejected = new Map(); // task ref -> submissions rejected in review since it was last reopened

  constructor({ repo, mirror, identity }) {
    this.repo = repo; // "owner/name"
    this.mirror = mirror;
    this.identity = identity;
    this.issues = new Map();
  }

  /** One REST call. `body` is sent as JSON. Returns the parsed response (or null for 204). */
  async api(method, endpoint, body) {
    const args = ['api', '-X', method, endpoint, '-H', 'Accept: application/vnd.github+json'];
    if (body !== undefined) args.push('--input', '-');
    const out = await must('gh', args, body !== undefined ? { input: JSON.stringify(body) } : {});
    return out.trim() ? JSON.parse(out) : null;
  }

  get repoPath() {
    return `repos/${this.repo}`;
  }

  async login() {
    this._login ??= (await this.api('GET', 'user')).login;
    return this._login;
  }

  async canPush() {
    this._push ??= Boolean((await this.api('GET', this.repoPath)).permissions?.push);
    return this._push;
  }

  /** Where a push to "owner/name" goes, and the git options that let gh supply the credential. */
  async #pushUrl(target) {
    const proto = CLOUD ? 'https' : (await run('gh', ['config', 'get', 'git_protocol', '-h', 'github.com'])).stdout.trim();
    const ssh = proto === 'ssh';
    // On a laptop gh supplies the https credential, so Swarm never handles a token. In a cloud
    // session the GitHub proxy does, and a helper of ours would only get in its way.
    return { url: ssh ? `git@github.com:${target}.git` : `https://github.com/${target}.git`, helper: !ssh && !CLOUD ? '!gh auth git-credential' : null };
  }

  /**
   * Git remote to push work to: the project itself for people with push access, otherwise the
   * volunteer's fork (created on first use).
   */
  async #pushRemote(workDir) {
    let target = this.repo; // "owner/name" to push to
    if (!(await this.canPush())) target = await this.#fork();
    const { url, helper } = await this.#pushUrl(target);
    await run('git', ['remote', 'remove', 'swarm-push'], { cwd: workDir });
    await git(workDir, ['remote', 'add', 'swarm-push', url]);
    if (helper) await git(workDir, ['config', 'credential.https://github.com.helper', helper]);
    return { remote: 'swarm-push', owner: target.split('/')[0] };
  }

  /**
   * Can work done here be submitted? Asked before any quota is spent, so nobody's agent does a
   * task that then has nowhere to go. It ends with a push that sends nothing (`--dry-run`):
   * GitHub answers that only for someone allowed to write, which also catches an expired login,
   * a read-only token and a session whose GitHub connection does not cover this repository.
   * With `prepare` the volunteer's fork is created if it is needed; without it nothing changes.
   */
  async access({ prepare = false } = {}) {
    const no = (reason) => ({ ok: false, reason });
    if (!CLOUD && (await run('gh', ['api', 'user', '-q', '.login'])).code !== 0) return no('the GitHub login here is missing or expired');
    let push;
    try {
      push = await this.canPush();
    } catch {
      return no(`${this.repo} is out of reach for the GitHub login here`);
    }
    let target = this.repo;
    if (!push) {
      if (process.env.SWARM_FORK) target = process.env.SWARM_FORK;
      else if (CLOUD) return no(`this cloud session has no write access to ${this.repo} or to a fork of it`);
      else if (!prepare) return { ok: true, route: 'fork' };
      else {
        try {
          target = await this.#fork();
        } catch (err) {
          return no(String(err.message).trim().split('\n')[0]);
        }
      }
    }
    const { url, helper } = await this.#pushUrl(target);
    const opts = helper ? ['-c', 'credential.https://github.com.helper=', '-c', `credential.https://github.com.helper=${helper}`] : [];
    const res = await run('git', [...opts, 'push', '--dry-run', '--quiet', url, `${this.mirror.base}:refs/heads/swarm/access-check`], {
      cwd: this.mirror.dir,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeoutMs: 60_000,
    });
    if (res.code !== 0) return no(`GitHub refused a push to ${target} (${(res.stderr || '').trim().split('\n')[0].replace(/^remote:\s*/, '') || 'no reason given'})`);
    return { ok: true, route: push ? 'direct' : 'fork' };
  }

  /**
   * The volunteer's fork, as "owner/name", created if needed.
   * GitHub creates forks in the background and may name one differently when the name is taken,
   * so the name comes from the API's answer and the fork is polled until it exists.
   */
  async #fork() {
    if (process.env.SWARM_FORK) return process.env.SWARM_FORK; // for sessions that cannot create one
    if (this._fork) return this._fork;
    let fork;
    try {
      fork = await this.api('POST', `${this.repoPath}/forks`, {});
    } catch (err) {
      throw new Error(`You cannot push to ${this.repo} and creating a fork failed. Fork it on GitHub, then retry (or set SWARM_FORK=you/fork).\n${err.message}`);
    }
    const name = fork.full_name;
    for (let i = 0; i < 20; i++) {
      if ((await run('gh', ['api', `repos/${name}/git/refs/heads/${this.mirror.branch}`])).code === 0) return (this._fork = name);
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error(`Your fork ${name} was requested but is not ready yet. Wait a minute and run again.`);
  }

  /** Task issues opened by a maintainer (or by the repository's own Actions bot), by task ref. */
  async #taskIssues() {
    const list = await this.api('GET', `${this.repoPath}/issues?state=open&per_page=100&sort=created&direction=asc`);
    const issues = new Map();
    for (const n of list) {
      if (n.pull_request) continue; // the issues endpoint also returns pull requests
      const m = TITLE.exec(n.title);
      if (!m || !isTrusted(n)) continue;
      const ref = `${m[1]}/${m[2]}`;
      if (issues.has(ref)) continue; // the oldest issue for a task is the log
      issues.set(ref, { number: n.number, url: n.html_url, comments: n.comments ? await this.#log(n.number) : [] });
    }
    return issues;
  }

  /** The comments on a task issue, oldest first, each marked with whether a maintainer wrote it. */
  async #log(number) {
    const comments = await this.api('GET', `${this.repoPath}/issues/${number}/comments?per_page=100`);
    return comments.map((c) => ({ id: c.id, body: c.body, createdAt: c.created_at, trusted: isTrusted(c) }));
  }

  async #openPrs() {
    const list = await this.api('GET', `${this.repoPath}/pulls?state=open&per_page=100&sort=created&direction=asc`);
    return list
      .map((pr) => {
        const m = TITLE.exec(pr.title);
        if (!m) return null;
        return {
          number: pr.number,
          url: pr.html_url,
          headRefOid: pr.head.sha,
          headRefName: pr.head.ref,
          sameRepo: pr.head.repo?.full_name === this.repo,
          taskRef: `${m[1]}/${m[2]}`,
          worker: WORKER_MARK.exec(pr.body || '')?.[1] || `gh:${pr.user?.login}`,
        };
      })
      .filter(Boolean);
  }

  #resolve(project, task, issue) {
    return resolveClaims(issue.comments, { taskRef: task.ref, ttlMinutes: project.claimTtlMinutes, knownSteps: [...project.verify, ...task.verify].map((s) => s.name) });
  }

  /** Map of task ref -> live claims and open submissions. Also records which tasks have no issue yet. */
  async claims(projects = this.mirror.projects) {
    this.issues = await this.#taskIssues();
    this.unpublished = new Set();
    this.failures = new Map();
    this.rejected = new Map();
    const live = new Map();
    for (const project of projects) {
      for (const task of project.tasks) {
        const issue = this.issues.get(task.ref);
        if (!issue) {
          this.unpublished.add(task.ref);
          continue;
        }
        const r = this.#resolve(project, task, issue);
        this.failures.set(task.ref, r.failures);
        if (r.rejections) this.rejected.set(task.ref, r.rejections);
        if (r.live.length) live.set(task.ref, r.live.map((c) => ({ ...c, mine: c.worker === this.identity?.id })));
      }
    }
    for (const pr of await this.#openPrs()) {
      const list = (live.get(pr.taskRef) || []).filter((c) => c.worker !== pr.worker);
      list.push({ worker: pr.worker, number: pr.number, submitted: true, mine: pr.worker === this.identity?.id });
      live.set(pr.taskRef, list);
    }
    return live;
  }

  /** How often each verify step failed for earlier workers on this task. */
  hints(taskRef) {
    return { failures: this.failures?.get(taskRef) || {} };
  }

  branchFor(task) {
    return `swarm/${task.ref}/${this.identity.id.slice(0, 8)}`;
  }

  async #comment(issue, kind, fields, text) {
    const doc = signDoc({ kind, ...fields, ts: new Date().toISOString() }, this.identity);
    const body = `${text}\n\n<!-- swarm:${kind} ${encode(doc)} -->`;
    return (await this.api('POST', `${this.repoPath}/issues/${issue.number}/comments`, { body })).html_url;
  }

  async claim({ project, task }) {
    const issue = this.issues.get(task.ref) || (await this.#taskIssues()).get(task.ref);
    if (!issue) return null;
    const handle = { issue, task: task.ref };
    await this.#comment(issue, 'claim', { task: task.ref }, `Claimed by Swarm worker \`${this.identity.id}\` (${this.identity.handle}). The claim lapses after ${project.claimTtlMinutes} minutes.`);
    // Earliest live claim wins. Re-read the log and see where ours landed.
    const fresh = (await this.#taskIssues()).get(task.ref);
    const order = fresh ? this.#resolve(project, task, fresh).live.map((c) => c.worker) : [];
    const submitted = (await this.#openPrs()).filter((pr) => pr.taskRef === task.ref && pr.worker !== this.identity.id).length;
    const position = order.indexOf(this.identity.id);
    if (position === -1 || position + submitted >= project.replication) {
      await this.release(handle);
      return null;
    }
    return handle;
  }

  /** Give the task back. `failedStep` (a verify step name, "policy" or "agent") is shared with later workers. */
  async release(handle, { failedStep } = {}) {
    if (!handle?.issue) return;
    const text = failedStep ? `Released by worker \`${this.identity.id}\`: did not get past \`${failedStep}\`. Nothing was pushed.` : `Released by worker \`${this.identity.id}\`.`;
    await this.#comment(handle.issue, 'release', { task: handle.task, failedStep }, text).catch(() => {});
  }

  async submit({ workDir, branch, claim, project, task, receipt, summary, approvalsNeeded }) {
    const { remote, owner } = await this.#pushRemote(workDir);
    await git(workDir, ['push', '--quiet', '--force', remote, `${branch}:refs/heads/${branch}`]);
    const body = [
      `Swarm submission for \`${task.ref}\`: **${task.title}** (task log: #${claim.issue.number})`,
      '',
      'This pull request exists because verification already passed on the worker\'s machine. CI now repeats it from the base branch\'s rules.',
      '',
      summary ? `### Agent summary\n\n${summary.slice(0, 6000)}` : '',
      '',
      '### Receipt',
      '',
      `- worker \`${receipt.signer.id}\` (${receipt.signer.handle})`,
      `- agent \`${receipt.agent.runner}\` / \`${receipt.agent.model}\`, ${receipt.attempts} attempt(s), API-equivalent cost $${receipt.usage.costUsd.toFixed(2)}`,
      `- verified locally in \`${receipt.sandbox}\` sandbox: ${receipt.verify.map((v) => `\`${v.name}\``).join(', ')}`,
      `- ${receipt.filesChanged} file(s), ${receipt.linesChanged} line(s) changed`,
      '',
      `Merging needs ${approvalsNeeded ?? project.review.quorum} approval(s) from other workers' agents (\`swarm review\` or \`swarm maintain\`).`,
      '',
      `<!-- swarm:worker ${this.identity.id} -->`,
    ].join('\n');
    const pr = await this.api('POST', `${this.repoPath}/pulls`, { title: `[swarm] ${task.ref}: ${task.title}`, head: `${owner}:${branch}`, base: this.mirror.branch, body });
    return { id: pr.number, where: pr.html_url };
  }

  async submissions() {
    return (await this.#openPrs()).map((pr) => ({ id: pr.number, taskRef: pr.taskRef, worker: pr.worker, head: pr.headRefOid, url: pr.url, branch: pr.headRefName, sameRepo: pr.sameRepo, mine: pr.worker === this.identity?.id }));
  }

  async fetchSubmission(sub) {
    await git(this.mirror.dir, ['fetch', '--quiet', 'origin', `pull/${sub.id}/head`]);
    return (await git(this.mirror.dir, ['rev-parse', 'FETCH_HEAD'])).trim();
  }

  async postReview(sub, review) {
    const icon = review.verdict === 'approve' ? '✅' : '❌';
    const body = [
      REVIEW_MARK,
      `${icon} **Swarm review: ${review.verdict}** by worker \`${review.signer.id}\` using \`${review.agent.runner}\` / \`${review.agent.model}\``,
      '',
      review.notes,
      '',
      '<details><summary>Signed review</summary>',
      '',
      '```json',
      JSON.stringify(review, null, 2),
      '```',
      '</details>',
    ].join('\n');
    await this.api('POST', `${this.repoPath}/issues/${sub.id}/comments`, { body });
    return { where: sub.url };
  }

  /** Signed reviews posted on a submission. `trustedOnly` keeps those posted by someone with push access. */
  async reviews(sub, { trustedOnly = false } = {}) {
    const comments = await this.api('GET', `${this.repoPath}/issues/${sub.id}/comments?per_page=100`);
    const docs = [];
    for (const c of comments) {
      if (!c.body?.includes(REVIEW_MARK) || (trustedOnly && !isTrusted(c))) continue;
      const m = /```json\n([\s\S]*?)\n```/.exec(c.body);
      try {
        const doc = m ? JSON.parse(m[1]) : null;
        if (doc && typeof doc === 'object') docs.push(doc); // `null` is valid JSON and would trip every reader
      } catch {
        /* malformed review comments are ignored */
      }
    }
    return docs;
  }

  async merge(sub) {
    // A merge commit keeps the work commit (and so the receipt's tree hash) in history.
    await this.api('PUT', `${this.repoPath}/pulls/${sub.id}/merge`, { merge_method: 'merge' });
    await this.#dropBranch(sub);
    return { where: sub.url };
  }

  /** Leave no branch behind when the submission was pushed to this repository rather than a fork. */
  async #dropBranch(sub) {
    if (sub.sameRepo && sub.branch?.startsWith('swarm/')) {
      await run('gh', ['api', '-X', 'DELETE', `${this.repoPath}/git/refs/heads/${sub.branch}`]);
    }
  }

  /**
   * Close a submission that was rejected in review, so its task is offered again, and note the
   * rejection in the task's log. Needs push access; returns null without it. The note is written
   * first and counted once per work commit, so a pass that dies half way can simply run again.
   * `worker` and `work` are the submitter and the work commit, as the signed receipt has them.
   * Returns how many submissions for the task have been rejected since it was last reopened.
   */
  async withdraw(sub, { worker = sub.worker, work = sub.head } = {}) {
    if (!(await this.canPush())) return null;
    const issue = (await this.#taskIssues()).get(sub.taskRef);
    let rejections = 0;
    if (issue) {
      const fields = { task: sub.taskRef, work, submission: sub.id, worker };
      await this.#comment(issue, 'reject', fields, `Submission #${sub.id} from worker \`${worker}\` was rejected in review and closed. The task is open for another attempt.`);
      rejections = resolveClaims(await this.#log(issue.number), { taskRef: sub.taskRef, ttlMinutes: 0 }).rejections;
    }
    const where = issue ? ` The task is open for another attempt (task log: #${issue.number}).` : '';
    await this.api('POST', `${this.repoPath}/issues/${sub.id}/comments`, { body: `Closed by Swarm: a reviewer rejected this change, so it cannot be merged.${where}` });
    await this.api('PATCH', `${this.repoPath}/pulls/${sub.id}`, { state: 'closed' });
    await this.#dropBranch(sub);
    return { where: sub.url, rejections };
  }

  /** Maintainers: offer a parked task to workers again. The count of rejections starts over. */
  async reopen(task) {
    if (!(await this.canPush())) throw new Error(`Reopening a task needs push access to ${this.repo}.`);
    const issue = (await this.#taskIssues()).get(task.ref);
    if (!issue) throw new Error(`${task.ref} has no open log issue. Run \`swarm sync\` first.`);
    await this.#comment(issue, 'reopen', { task: task.ref }, 'Reopened by a maintainer. Earlier rejections no longer count against this task.');
  }

  /**
   * Maintainers: open an issue for every ready task that has none, close issues of finished
   * tasks. `done` is a Map of project id -> Set of finished task ids.
   */
  async sync(projects, done) {
    const issues = await this.#taskIssues();
    const result = { opened: [], closed: [] };
    for (const project of projects) {
      for (const task of project.tasks) {
        const issue = issues.get(task.ref);
        const finished = done.get(project.id)?.has(task.id);
        if (!issue && !finished && task.status === 'ready') {
          const body = [
            `**${task.title}**  ·  project \`${project.id}\`  ·  size ${task.size}`,
            '',
            `This issue is the log for a Swarm task. The task itself is the file [\`${task.file}\`](../blob/${this.mirror.branch}/${task.file}); agents work from that file, never from this issue or its comments.`,
            '',
            'To work on it with your own Claude Code or Codex plan:',
            '',
            '```',
            `npx github:${this.repo} run --task ${task.ref}`,
            '```',
            '',
            'Claims and releases appear below as signed comments. A pull request is opened only after verification passes on the worker\'s machine.',
          ].join('\n');
          const created = await this.api('POST', `${this.repoPath}/issues`, { title: `[swarm] ${task.ref}: ${task.title}`, body });
          result.opened.push({ ref: task.ref, url: created.html_url });
        } else if (issue && finished) {
          await this.api('POST', `${this.repoPath}/issues/${issue.number}/comments`, { body: 'Done: a verified submission for this task was merged.' });
          await this.api('PATCH', `${this.repoPath}/issues/${issue.number}`, { state: 'closed' });
          result.closed.push({ ref: task.ref, url: issue.url });
        }
      }
    }
    return result;
  }
}
