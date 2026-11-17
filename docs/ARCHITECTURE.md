# Architecture

Swarm is a single Node CLI with no npm dependencies. It shells out to `git`, `gh`, the agent CLI
and the OS sandbox. There is no server.

## Layout

```
bin/swarm.mjs            entry point
src/cli.mjs              commands, quota guard
src/worker.mjs           claim -> agent -> policy -> verify -> receipt -> submit
src/review.mjs           independent re-verification, review tally   (protected)
src/merge.mjs            the merge rule                              (protected)
src/project.mjs          manifests and task files (.swarm/projects/<id>/)
src/repo.mjs             local mirror, fresh work clones, rules as of a given commit
src/board/github.mjs     claims and submissions as pull requests, via gh
src/board/git.mjs        the same over plain git refs
src/runners/*.mjs        claude, codex, mock
src/mcp.mjs              MCP connector over stdio (`swarm mcp`): tools, background jobs
src/session.mjs          connector sessions and their confined file tools   (protected)
plugin/                  Claude plugin: one skill that carries a pinned copy of the CLI, plus connector config
src/registry.json        projects that opted in, shown when a user chooses
src/sandbox.mjs          seatbelt, bubblewrap, docker           (protected)
src/verify.mjs           diff policy and verify steps           (protected)
src/receipt.mjs          receipts, reviews, structural check    (protected)
src/identity.mjs         ed25519 keys and signatures            (protected)
gtm/                     the GTM harness: facts, channels, checks, assets
```

Files marked protected cannot be changed by a Swarm contribution. People change them through
ordinary pull requests. The full list is `protect` in `.swarm/projects/core/project.json`: the
sandbox, signing, the merge rule, and the modules those stand on (manifest loading, path
matching, the boards). Plugin releases are also cut by a person, with
`node scripts/build-plugin.mjs`, so plugin users run a snapshot someone chose to ship rather
than every merged change. Agents do everything else: write, check, review, merge.

## Trust boundaries

| Component | Trusted by | Why |
|---|---|---|
| Task files and manifests on the default branch | volunteers | Merged by maintainers. Nothing else is ever turned into a prompt or a command. |
| The agent's output | nobody | It is a diff. It is policy-checked, then executed only inside the sandbox. |
| The volunteer's receipt | nobody | CI and reviewers recompute everything they can from git. |
| The Swarm code that verifies | maintainers, via CI | CI runs Swarm from the base commit, so a pull request cannot alter its own verifier. |

## A submission

```
base ── work commit ── receipt commit
```

The work commit is the agent's change. The receipt commit adds exactly one file,
`.swarm/receipts/<project>/<task>/<worker>.json`. `checkSubmission()` in `src/receipt.mjs` rejects
anything else: extra commits, a receipt whose tree hash or diff hash does not match git, a bad
signature, a task that does not exist at the base, or a diff that breaks the path policy.

A task is done when a receipt for it exists on the default branch. Task files are never edited to
close them, and the ledger is the set of merged receipts.

## Who merges

No person has to. `swarm maintain` is the maintainer's pass, meant for an agent on a schedule:
for each open submission it re-checks structure, signature and policy, reproduces the verify
steps in the sandbox, reviews it with the agent CLI if it came from another worker, and merges it
when the project's quorum of independent approvals is met and nobody rejected it. A worker's
review of its own submission never counts, so one agent writes and a different one approves.
`swarm merge` is the same merge step for a single submission.

## Claims

**GitHub.** Pull requests are costly for maintainers, so everything before a verified result
happens on one issue per task, opened by a maintainer with `swarm sync` (issues opened by anyone
else are ignored). A claim is a comment carrying a signed document. `resolveClaims()` in
`src/board/github.mjs` replays the comments oldest first: the earliest live claim wins, the expiry
clock is GitHub's comment timestamp rather than anything the worker wrote, and a worker can release
only its own claim. A release may name the verify step that failed; only names that match the
project's own step names are kept, and those counts are the one thing passed into later workers'
prompts. A pull request is opened at submission, after local verification passed. Volunteers
without push access push to a fork.

**Plain git.** A claim is `refs/swarm/claims/<project>/<task>`, created with
`git push --force-with-lease=<ref>:` (the ref must not exist) or swapped with the expired claim's
hash as the lease. The remote decides the winner atomically. Merging deletes the submission branch
and its review refs, so the only long-lived ref is the default branch.

## Sandbox

`runSandboxed()` runs a shell command from the project manifest against a work directory:

- **seatbelt (macOS):** `sandbox-exec` with a profile that denies network except loopback, denies
  writes except the work directory and a private temp directory, and denies reads under the home
  directory except the work directory and the Node installation.
- **bwrap (Linux):** read-only root, tmpfs over the home directory, work directory bound
  read-write, no network namespace.
- **docker:** `--network none`, all capabilities dropped, the work directory mounted, when the
  project names an image.

In all modes the environment is replaced with a minimal one (`PATH`, a throwaway `HOME`, `TMPDIR`,
`CI=1`). In CI the throwaway runner VM is the sandbox.

## Connector

`swarm mcp` exposes the same pipeline to any MCP host. `handle()` in `src/mcp.mjs` implements the
small part of the protocol that is needed (initialize, tools/list, tools/call) with no dependency;
stdout carries only protocol messages.

- **Delegate mode.** `swarm_donate` and `swarm_review` start `swarm run` or `swarm review` as a
  detached process and return a job id, because an agent run outlasts most hosts' tool-call
  timeout. `swarm_job` reports state and the tail of the log. One job at a time.
- **Connector mode.** `swarm_begin` claims a task and creates the clone, and returns a session id
  rather than a path. `swarm_list`, `swarm_read`, `swarm_search`, `swarm_write`, `swarm_edit` and
  `swarm_delete` resolve every path through `resolveInside()` in `src/session.mjs`: no absolute
  paths, no `..`, no `.git`, no symlink that leaves the clone; writes are also checked against the
  task's `paths` and the protected globs before they happen. `swarm_finish` runs the same policy
  check, sandboxed verification, receipt and submission as the CLI, gives the verifier's output
  back on failure for up to three attempts, and returns the stored outcome if called again.
  Sessions are JSON files under `~/.swarm/sessions`, read against the rules as of the commit the
  session started from.

- **Shell mode.** `swarm task begin`, `finish` and `abandon` are the same sessions driven from a
  shell, printing JSON. This is what a Claude Code cloud session uses: the plugin's local
  connector does not exist there, but the skill and its scripts do. The agent edits the clone
  with its own tools, so confinement is the policy check at `finish`, not the tools. Inside a
  cloud session (`CLAUDE_CODE_REMOTE=true`) verify steps run in sandbox mode `cloud-vm`: the
  session's disposable VM, with a scrubbed environment.

GitHub is reached only through `gh api` and REST. Cloud sessions go through a proxy that rejects
GraphQL, which `gh pr`, `gh issue` and `gh repo view` depend on, so the board avoids them
everywhere rather than having two code paths.

The plugin in `plugin/` has one skill, `swarm`, which bundles a copy of the CLI under
`skills/swarm/scripts/swarm`. A skill's scripts travel with it to every place skills load, so
the same copy serves the shell path in cloud sessions and the local connector, which starts
with plain `node`. `node scripts/build-plugin.mjs` refreshes that copy; it is cut by a maintainer,
so plugin users run a reviewed snapshot rather than every merged change. The plugin has no
top-level `bin/` directory because claude.ai and Cowork refuse plugins that have one.

## Adopting Swarm in another repository

1. Add `.swarm/projects/<id>/project.json` with `paths`, `protect`, `verify`.
2. Add task files under `.swarm/projects/<id>/tasks/`. Put a pinned acceptance test next to a task
   and name it in the task's `verify` list; the tasks directory is always protected.
3. Copy `.github/workflows/swarm-verify.yml`. It checks out this repository's Swarm code from the
   base commit; in another repository, replace that step with a checkout of a pinned Swarm release.
4. Require the `swarm-verify` status check and allow merge commits (a merge commit keeps the work
   commit, and so the receipt's hashes, in history).
