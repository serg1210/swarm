# Adopting Swarm in your repository

## Before you start

What a volunteer's agent can do:

- Read the repository and create, edit or delete files that match the task's `paths`.
- Usually nothing else: the Claude runner gets only file read, search and edit tools, with no
  shell, web access or MCP servers. An agent started with `swarm task begin` (for example in a
  cloud session) may have a shell, so do not rely on agents being unable to run code.

What it cannot do:

- Change protected files. These are always protected, whatever your manifest says:
  `.swarm/projects/*/project.json`, `.swarm/projects/*/tasks/**`, `.github/**`,
  `.swarm/receipts/**`, `.swarm/reviews/**`, `.git/**` and `.gitmodules`.
- Add symlinks or submodules, or exceed the size limits in your manifest.
- Run your verify commands itself. Swarm runs them in a sandbox with no network, a scrubbed
  environment and write access only to the work directory.

Only task files merged to your default branch are executed. CI loads projects and tasks from the
base commit of a pull request, so a submission cannot add a task, change a rule or bring its own
tests.

## Add a project

Create `.swarm/projects/<id>/project.json`. The `<id>` is the directory name. Every key is
optional; the defaults are shown in brackets.

- `paths` (`["**"]`): globs of files a contribution may change. A task can narrow this.
- `protect` (`[]`): globs no contribution may change, added to the always-protected list. Protect
  your test helpers, build config and anything that decides whether a change passes.
- `verify` (`[]`): steps run for every task in this project. Each needs `name` and `run` (a shell
  command run from the repository root); `timeoutSec` defaults to 300.
- `limits` (`{ "maxFilesChanged": 40, "maxDiffLines": 2000 }`): a larger diff is rejected.
- `review` (`{ "quorum": 1 }`): independent approvals `swarm merge` needs.
- `replication` (`1`): how many workers may hold a live claim on the same task at once.
- `claimTtlMinutes` (`90`): when an unfinished claim lapses and the task reopens.
- `sandbox` (none): `image` names a Docker image, used when neither macOS `sandbox-exec` nor
  Linux bubblewrap is available. `network: true` gives verify commands network access; leave it
  off unless your tests cannot run without it.

```json
{
  "name": "My library",
  "description": "Parser and command-line tool.",
  "paths": ["src/**", "test/**", "docs/**"],
  "protect": ["package.json", "test/helpers/**"],
  "verify": [{ "name": "unit-tests", "run": "node --test test/*.test.mjs", "timeoutSec": 300 }],
  "limits": { "maxFilesChanged": 20, "maxDiffLines": 1000 },
  "review": { "quorum": 1 },
  "replication": 1,
  "claimTtlMinutes": 90,
  "sandbox": { "image": "node:22", "network": false }
}
```

Without `network`, verify commands cannot download anything, so commit dependencies or use an
image that has them.

## Write tasks

A task is a Markdown file in `.swarm/projects/<id>/tasks/`. The file name is the task id unless
the frontmatter sets `id`; ids are lowercase letters, digits and dashes.

```markdown
---
title: Support {a,b} alternation in path globs
size: S
paths: ["src/util.mjs", "test/**"]
verify: ["node --test .swarm/projects/core/tasks/glob-braces.test.mjs"]
---
## Goal
...
## Acceptance
...
```

Frontmatter keys:

- `title`: shown in listings and used as the commit message. Defaults to the id.
- `size`: a hint such as `S`, `M` or `L`. Defaults to `M`.
- `status`: only `ready` (the default) tasks are offered. Use any other value, such as `draft`,
  to hold a task back.
- `paths`: replaces the project's `paths` for this task.
- `verify`: extra steps run after the project's. A string becomes a step named `task-1`,
  `task-2` and so on; you can also give `{ "name", "run", "timeoutSec" }`.

The body becomes the agent's instructions. Assume the agent cannot run anything: name the files to
read and the functions to change, state acceptance as observable behaviour with examples, keep
`paths` narrow, and keep the change small enough to review in minutes. After a failed verify step
the agent sees its output and gets one more attempt by default.

A task is done when a receipt for it is merged; you never edit the task file to close it. On
GitHub, run `swarm sync` after merging new tasks to open the issue workers claim on.

## Pin acceptance tests

If the agent can edit the test that judges it, it can make the test pass by weakening it. To
prevent that, put the acceptance test next to the task, for example
`.swarm/projects/<id>/tasks/glob-braces.test.mjs`, and run it from the task's `verify`.

This works because everything under `tasks/` is always protected: any diff that touches the test is
rejected before verification runs. The test is taken from your default branch, so merge the task
and its test together, before volunteers can pick the task up. Write the test against public
behaviour so more than one correct implementation passes.

## Set up CI

Copy `.github/workflows/swarm-verify.yml` from the Swarm repository. It checks out the base commit
and the pull request side by side and runs `swarm ci --cwd pr --base <base sha> --title <title>`.
Swarm runs its own CLI from `base/bin/swarm.mjs`; in your repository use
`npx -y github:serg1210/swarm#<commit>`, pinned to a commit you have read, and drop the plugin
snapshot step.

The rules come from the base commit, never from the pull request, so a submission cannot change
the verifier or the rules that judge it. For a pull request titled `[swarm] ...`, `swarm ci`
checks that the branch is a work commit plus a receipt commit, the receipt signature, that the
task exists at the base, and the path and size policy, then reruns the verify steps. Other pull
requests just run each project's verify steps.

In your branch protection settings for the default branch:

- Require the `verify` status check to pass before merging.
- Allow merge commits. `swarm merge` uses one so the work commit, whose tree hash the receipt
  records, stays in history.

## Review and merge

`swarm review` is run by volunteers other than the submitter. It re-checks the submission's
structure, signature and policy, reruns the verify steps in the reviewer's own sandbox, then has a
read-only agent read the diff against the task and look for cheating, unsafe code and unrelated
changes. It posts a signed review with an approve or reject verdict.

`swarm merge <pull request number>` re-verifies the submission on your machine and counts reviews.
Only signed reviews for that exact work commit count, at most one per reviewer (their latest), and
never the submitter's own. Any rejection blocks the merge, and it needs at least `review.quorum`
approvals. `--force` overrides both; read the reviews first. Passing tests and a review do not
prove a change correct; you still decide what merges.
