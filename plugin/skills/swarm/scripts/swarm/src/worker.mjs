// The volunteer's work loop: pick a task, claim it, let the agent edit a fresh clone, verify
// in the sandbox, sign a receipt, submit.
import fs from 'node:fs';
import path from 'node:path';
import { SWARM_HOME, ensureDir, step, ok, warn, fail, c, fmtUsd, fmtDuration } from './util.mjs';
import { completedTasks, protectedGlobs, verifySteps, receiptPath } from './project.mjs';
import { git, diffSummary, checkPolicy, runVerify, describeFailure } from './verify.mjs';
import { buildReceipt } from './receipt.mjs';
import { makeWorkDir } from './repo.mjs';
import { requiredQuorum } from './quorum.mjs';

export function buildPrompt({ project, task, feedback, hints, mode = 'cli', workDir, session, agentShell = false }) {
  const cloud = process.env.CLAUDE_CODE_REMOTE === 'true';
  const steps = verifySteps(project, task);
  const lines = [
    'You are a volunteer coding agent contributing to an open-source project through Swarm.',
    'A maintainer wrote the task below. Complete it in the repository in the current directory.',
    '',
    `# Task ${task.ref}: ${task.title}`,
    '',
    task.body,
    '',
    '# Rules',
    `- You may create or change only files matching: ${task.paths.join(', ')}`,
    `- Never change: ${protectedGlobs(project).join(', ')}`,
    mode === 'connector'
      ? '- Read and change files only through the swarm_list, swarm_read, swarm_search, swarm_write, swarm_edit and swarm_delete tools. Do not run commands and do not use any other file or shell tool on this repository.'
      : mode === 'shell'
        ? `- The repository is checked out at ${workDir}. Read and change files only inside that directory. Do not commit, push, switch branches or touch its .git directory: Swarm does that.${cloud ? ' You may run the verify steps yourself in that directory to check your work.' : " Do not run the project's code yourself: the finish step runs the checks in a sandbox."}`
        : agentShell
          ? "- Use your shell only to read and edit files in the current directory. It has no network, and you must not use web search. Do not run the project's code or its tests, and do not commit: Swarm runs the checks and commits. Read the code carefully instead of guessing."
          : '- You cannot run commands. Read the code carefully instead of guessing.',
    '- When you finish, an automated verifier runs these steps in a sandbox with no network access:',
    ...steps.map((s) => `    - ${s.name}: ${s.run}`),
    '  If a step fails you get its output and one more attempt.',
    '- Keep the change small and focused on the task. Follow the style of the surrounding code.',
    '- Add or update tests when you change behaviour. Do not add dependencies unless the task says so.',
    mode === 'connector' ? '- If the task cannot be done as written, call swarm_abandon and explain why.' : mode === 'shell' ? `- If the task cannot be done as written, run the Swarm CLI with: task abandon --session ${session} --reason "<why>".` : '- If the task cannot be done as written, change nothing and explain why.',
    mode === 'connector'
      ? '- When you are done, call swarm_finish with a short summary of what you changed and why. It becomes the pull request description. If it reports a failure, fix the problem and call it again.'
      : mode === 'shell'
        ? `- When you are done, run the Swarm CLI with: task finish --session ${session} --summary "<what you changed and why>". The summary becomes the pull request description. If it reports a failure, fix the problem and run it again.`
        : '- End with a short summary of what you changed and why. It becomes the pull request description.',
  ];
  const failures = Object.entries(hints?.failures || {});
  if (failures.length) {
    lines.push(
      '',
      '# Where earlier workers got stuck',
      `Other volunteers' agents tried this task before you and did not get past: ${failures.map(([name, n]) => `${name} (${n}x)`).join(', ')}.`,
      'Take extra care with those checks before you finish.',
    );
  }
  if (feedback) {
    lines.push('', '# Previous attempt', 'Your earlier changes are still in the working tree. They were not accepted:', '', feedback, '', 'Fix the problem. Do not weaken or delete tests to make them pass.');
  }
  return lines.join('\n');
}

/** Tasks that are ready, not finished, and not already claimed by enough workers. */
export function openTasks(projects, mirrorDir, claims, { projectId, taskRef, unpublished = new Set() } = {}) {
  const open = [];
  for (const project of projects) {
    if (projectId && project.id !== projectId) continue;
    const done = completedTasks(mirrorDir, project.id);
    for (const task of project.tasks) {
      if (taskRef && task.ref !== taskRef && task.id !== taskRef) continue;
      const live = claims.get(task.ref) || [];
      const state = done.has(task.id) ? 'done' : task.status !== 'ready' ? task.status : unpublished.has(task.ref) ? 'unpublished' : live.length >= project.replication ? 'claimed' : 'open';
      open.push({ project, task, state, claims: live });
    }
  }
  return open;
}

/** Commit the verified change, then commit a signed receipt for it. Returns the receipt. */
export async function sealWork({ workDir, project, task, base, diff, agent, usage, verify, sandbox, attempts, identity }) {
  await git(workDir, ['commit', '--quiet', '-m', `${task.title}\n\nSwarm-Task: ${task.ref}\nSwarm-Worker: ${identity.id}`]);
  const work = (await git(workDir, ['rev-parse', 'HEAD'])).trim();
  const tree = (await git(workDir, ['rev-parse', 'HEAD^{tree}'])).trim();
  const receipt = buildReceipt({ project, task, base, work, tree, diff, agent, usage, verify, sandbox, attempts, identity });
  const file = receiptPath(project.id, task.id, identity.id);
  ensureDir(path.dirname(path.join(workDir, file)));
  fs.writeFileSync(path.join(workDir, file), JSON.stringify(receipt, null, 2) + '\n');
  await git(workDir, ['add', '-f', file]);
  await git(workDir, ['commit', '--quiet', '-m', `swarm: receipt for ${task.ref}`]);
  return receipt;
}

export function record(entry) {
  ensureDir(SWARM_HOME);
  fs.appendFileSync(path.join(SWARM_HOME, 'history.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

/**
 * Work on one task. Returns { status: 'submitted' | 'failed' | 'lost-claim' | 'dry-run', ... }.
 */
export async function workOn({ repo, mirror, board, identity, runner, project, task, opts }) {
  const branch = board.branchFor(task);
  const workDir = await makeWorkDir(repo, mirror, { name: `${project.id}-${task.id}`, commit: mirror.base, branch });
  const keep = () => warn(`Work directory kept for inspection: ${workDir}`);

  step(`Claiming ${c.bold(task.ref)}: ${task.title}`);
  const claim = opts.dryRun ? { dry: true } : await board.claim({ project, task, workDir, branch, base: mirror.base });
  if (!claim) {
    warn('Another worker got there first.');
    fs.rmSync(workDir, { recursive: true, force: true });
    return { status: 'lost-claim' };
  }

  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0, durationMs: 0 };
  let agentInfo = null;
  let feedback = null;
  let verify = null;
  let diff = null;
  let summary = '';
  let rateLimit = null;
  let attempts = 0;
  let failedStep = null; // shared with later workers when this attempt is given up
  const hints = board.hints?.(task.ref);

  try {
    for (attempts = 1; attempts <= opts.attempts; attempts++) {
      step(`Agent ${c.bold(runner.name)} working (attempt ${attempts}/${opts.attempts}, budget ${fmtUsd(opts.budgetUsd)})`);
      const started = Date.now();
      const res = await runner.runAgent({
        cwd: workDir,
        prompt: buildPrompt({ project, task, feedback, hints, agentShell: Boolean(runner.hasShell) }),
        model: opts.model,
        effort: opts.effort,
        budgetUsd: opts.budgetUsd,
        timeoutMs: opts.timeoutMinutes * 60_000,
      });
      usage.inputTokens += res.usage?.inputTokens || 0;
      usage.outputTokens += res.usage?.outputTokens || 0;
      usage.costUsd += res.usage?.costUsd || 0;
      usage.turns += res.usage?.turns || 0;
      usage.durationMs += res.usage?.durationMs || Date.now() - started;
      rateLimit = res.rateLimit || rateLimit;
      agentInfo = { runner: res.runner || runner.name, model: res.model, version: res.version };
      summary = res.summary || summary;
      if (!res.ok) {
        fail(`Agent stopped: ${res.error}`);
        failedStep = 'agent';
        break; // budget, rate limit or crash: retrying would only burn quota
      }

      await git(workDir, ['add', '-A']);
      diff = await diffSummary(workDir, mirror.base);
      const problems = checkPolicy(diff, project, task);
      if (problems.length) {
        feedback = `The change breaks the contribution policy:\n${problems.map((p) => `- ${p}`).join('\n')}`;
        fail(`Policy: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ''}`);
        verify = null;
        failedStep = 'policy';
        continue;
      }

      step(`Verifying in ${c.bold(opts.sandbox)} sandbox`);
      verify = await runVerify(project, task, { workDir, sandbox: opts.sandbox, onStep: (s) => step(`  ${s.name}: ${c.dim(s.run)}`) });
      if (verify.ok) break;
      feedback = describeFailure(verify);
      failedStep = verify.results.at(-1).name;
      fail(`Verification failed at "${failedStep}"`);
    }

    if (!verify?.ok) {
      if (!opts.dryRun) await board.release(claim, { failedStep });
      record({ repo: repo.slug, task: task.ref, status: 'failed', usage, runner: runner.name });
      keep();
      return { status: 'failed', usage, rateLimit, workDir };
    }

    ok(`Verified: ${verify.results.map((r) => r.name).join(', ')} (${diff.files.length} files, ${diff.lines} lines)`);
    const receipt = await sealWork({ workDir, project, task, base: mirror.base, diff, agent: agentInfo, usage, verify, sandbox: opts.sandbox, attempts: Math.min(attempts, opts.attempts), identity });

    if (opts.dryRun) {
      ok(`Dry run: nothing pushed. Result is in ${workDir}`);
      return { status: 'dry-run', usage, rateLimit, workDir, receipt };
    }
    const sub = await board.submit({ workDir, branch, claim, project, task, receipt, summary, approvalsNeeded: requiredQuorum(project, diff.files.map((f) => f.file)) });
    record({ repo: repo.slug, task: task.ref, status: 'submitted', usage, runner: runner.name, where: sub.where });
    ok(`Submitted ${c.bold(task.ref)} → ${sub.where}  ${c.dim(`(${fmtUsd(usage.costUsd)} API-equivalent, ${fmtDuration(usage.durationMs)})`)}`);
    fs.rmSync(workDir, { recursive: true, force: true });
    return { status: 'submitted', usage, rateLimit, receipt, submission: sub };
  } catch (err) {
    if (!opts.dryRun) await board.release(claim).catch(() => {});
    keep();
    throw err;
  }
}
