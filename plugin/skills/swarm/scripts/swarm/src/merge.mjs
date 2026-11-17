// The merge rule. This file, like the sandbox and the signing code, is changed only by people:
// contributions made through Swarm cannot touch it (see `protect` in the core project manifest).
//
// A submission is merged when all of these hold:
//   - its shape, signature and path policy check out against the rules of its base commit;
//   - the project's verify steps pass on the machine doing the merge;
//   - it has the project's quorum of signed approvals, for this exact commit, from workers
//     other than the one who submitted it;
//   - no such worker's latest review is a rejection.
// An agent can run this on a schedule (`swarm maintain`); it cannot approve its own worker's work.
import fs from 'node:fs';
import { step, ok, log, c } from './util.mjs';
import { describeFailure } from './verify.mjs';
import { reverify, tallyReviews } from './review.mjs';

/** Returns { merged: true } or { merged: false, reason, waiting }. */
export async function mergeIfReady(ctx, sub, { sandbox, force = false, dryRun = false, runChecks = true }) {
  const head = await ctx.board.fetchSubmission(sub);
  if (runChecks) step(`Re-verifying ${sub.taskRef} (${sub.id}) in ${sandbox} sandbox`);
  const r = await reverify({ repo: ctx.repo, mirror: ctx.mirror, head, sandbox, runChecks });
  if (r.workDir) fs.rmSync(r.workDir, { recursive: true, force: true });
  if (!r.ok) return { merged: false, reason: `Submission is not valid:\n${r.problems.map((p) => `- ${p}`).join('\n')}` };
  if (!r.verify.ok) return { merged: false, reason: `Verification failed:\n${describeFailure(r.verify)}` };
  const tally = tallyReviews(await ctx.board.reviews(sub), r.receipt);
  log(c.dim(`  reviews: ${tally.approvals} approve, ${tally.rejections} reject; quorum ${r.project.review.quorum}`));
  if (tally.rejections && !force) return { merged: false, reason: 'A reviewer rejected this submission. Read the review, then use --force if you disagree.' };
  if (tally.approvals < r.project.review.quorum && !force) {
    const who = sub.mine ? 'This is your own submission, so the approval has to come from another worker.' : 'Another worker has to run `swarm review` or `swarm maintain`.';
    return { merged: false, waiting: true, reason: `Needs ${r.project.review.quorum} independent approval(s); has ${tally.approvals}. ${who}` };
  }
  if (dryRun) return { merged: false, waiting: true, reason: 'Ready to merge (dry run, nothing merged).' };
  const merged = await ctx.board.merge(sub);
  ok(`Merged ${sub.taskRef} → ${merged.where}`);
  return { merged: true };
}
