// The merge rule, kept in one place so a change to it is easy to see in review.
//
// A submission is merged when all of these hold:
//   - its shape, signature and path policy check out against the rules of its base commit;
//   - the project's verify steps pass on the machine doing the merge;
//   - it has the required number of signed approvals, for this exact commit, from workers
//     other than the one who submitted it. The number is the project's quorum, or more when
//     the change touches paths the project put in a higher tier (see quorum.mjs);
//   - no such worker's latest review is a rejection.
// An agent can run this on a schedule (`swarm maintain`); it cannot approve its own worker's work.
//
// A rejected submission can never be merged, and while it stays open it holds its task. The
// maintainer's pass therefore withdraws it (withdrawIfRejected), which opens the task again.
import fs from 'node:fs';
import { step, ok, fail, log, c } from './util.mjs';
import { describeFailure } from './verify.mjs';
import { verifyDoc } from './identity.mjs';
import { reverify, tallyReviews } from './review.mjs';
import { requiredQuorum, maxRejections } from './quorum.mjs';

/** Returns { merged: true } or { merged: false, reason, waiting }, with `rejected` and the receipt when a review blocks it. */
export async function mergeIfReady(ctx, sub, { sandbox, force = false, dryRun = false, runChecks = true }) {
  const head = await ctx.board.fetchSubmission(sub);
  if (runChecks) step(`Re-verifying ${sub.taskRef} (${sub.id}) in ${sandbox} sandbox`);
  const r = await reverify({ repo: ctx.repo, mirror: ctx.mirror, head, sandbox, runChecks });
  if (r.workDir) fs.rmSync(r.workDir, { recursive: true, force: true });
  // A receipt that is not properly signed names no worker, so nothing can be said about reviews of it.
  const signed = Boolean(r.receipt) && verifyDoc(r.receipt).ok;
  const tally = signed ? tallyReviews(await ctx.board.reviews(sub), r.receipt) : { approvals: 0, rejections: 0 };
  // A review can reject for the very reason the merge stops here (the checks do not pass), so the
  // caller is told about the rejection in every case, not only when the checks were fine.
  const rejection = tally.rejections ? { rejected: true, receipt: r.receipt, project: r.project } : {};
  if (!r.ok) return { merged: false, ...rejection, reason: `Submission is not valid:\n${r.problems.map((p) => `- ${p}`).join('\n')}` };
  if (!r.verify.ok) return { merged: false, ...rejection, reason: `Verification failed:\n${describeFailure(r.verify)}` };
  const need = requiredQuorum(r.project, r.diff.files.map((f) => f.file));
  log(c.dim(`  reviews: ${tally.approvals} approve, ${tally.rejections} reject; needs ${need}`));
  if (tally.rejections && !force) return { merged: false, ...rejection, reason: 'A reviewer rejected this submission. Read the review, then use --force if you disagree.' };
  if (tally.approvals < need && !force) {
    const who = sub.mine ? 'This is your own submission, so the approval has to come from another worker.' : 'Another worker has to run `swarm review` or `swarm maintain`.';
    return { merged: false, waiting: true, reason: `Needs ${need} independent approval(s); has ${tally.approvals}. ${who}` };
  }
  if (dryRun) return { merged: false, waiting: true, reason: 'Ready to merge (dry run, nothing merged).' };
  const merged = await ctx.board.merge(sub);
  ok(`Merged ${sub.taskRef} → ${merged.where}`);
  return { merged: true };
}

/**
 * Withdraw a submission that was rejected, so that another worker can take the task.
 *
 * Only rejections the board vouches for count: on GitHub, reviews posted by an account with push
 * access. A signed review proves which key wrote it, not who holds the key, and without this a
 * stranger with a fresh key could close anyone's work. Other rejections still block the merge,
 * as before, and wait for a person.
 *
 * Returns { withdrawn, rejections, stuck }: how often the task's submissions have now been
 * rejected, and whether that parked the task.
 */
export async function withdrawIfRejected(ctx, sub, { receipt, project }) {
  const tally = tallyReviews(await ctx.board.reviews(sub, { trustedOnly: true }), receipt);
  if (!tally.rejections) return { withdrawn: false };
  // The worker and the commit come from the signed receipt, not from what the submission says about itself.
  const out = await ctx.board.withdraw(sub, { worker: receipt.signer.id, work: receipt.work });
  if (!out) return { withdrawn: false };
  const stuck = out.rejections >= maxRejections(project);
  fail(`Closed ${sub.taskRef} (${sub.id}): rejected in review. ${stuck ? `That is ${out.rejections} rejections, so the task is parked. Fix the task, then run: swarm reopen ${sub.taskRef}` : 'The task is open for another attempt.'}`);
  return { withdrawn: true, rejections: out.rejections, stuck };
}
