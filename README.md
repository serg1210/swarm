# Swarm

Install the plugin, choose an open-source project, and the Claude or Codex quota you were not
going to use is spent doing tasks that project's maintainers wrote.

## Three steps

1. **Install the plugin.** In Claude Code: `/plugin install swarm --marketplace serg1210/swarm`.
   In the Claude desktop app or claude.ai: Customize > Plugins > Add marketplace > `serg1210/swarm`.
2. **Choose a project.** Say "set up Swarm". Claude lists the projects that opted in and you pick.
3. **Leftover quota does the work.** Claude offers to schedule it: on your computer, where Swarm
   reads your quota windows and keeps a 20% reserve, or in the cloud, where it runs with your
   laptop closed shortly before your weekly window resets. Each run does one task and opens a
   pull request under your GitHub account. You see each run as a short checklist that ticks
   itself off: quota left, project, task, checks, pull request.

Your tokens are spent by your own Claude, on a project you chose. Nothing is pooled or relayed.
What Swarm adds around the agent is the part that makes the result worth a maintainer's time: it
claims a task a maintainer wrote, checks the change against the project's rules, runs the
project's checks, signs a receipt and only then opens the pull request.

```
$ swarm run --task core/glob-braces
› Syncing serg1210/swarm
› Checking your quota
  5-hour: 28% used, resets in 4h 5m; weekly: 40% used, resets in 3d 23h
› Claiming core/glob-braces: Support {a,b} alternation in path globs
› Agent claude working (attempt 1/2, budget $2.00)
› Verifying in seatbelt sandbox
›   unit-tests: node --test test/*.test.mjs
›   task-1: node --test .swarm/projects/core/tasks/glob-braces.test.mjs
✓ Verified: unit-tests, task-1 (2 files, 31 lines)
✓ Submitted core/glob-braces → https://github.com/serg1210/swarm/pull/12  ($0.07 API-equivalent, 23s)
```

That is the first real run against this repository. You can read everything it left behind:
the [claim log](https://github.com/serg1210/swarm/issues/3), the
[pull request](https://github.com/serg1210/swarm/pull/12) with its CI re-verification and signed
review, and the [receipt](.swarm/receipts/core/glob-braces/40553ad5eb16a363.json). In that run the
reviewer was a second key on the maintainer's own account, which exercises the mechanics but is
not an independent review.

Since then:

- [A contribution from someone else's machine](https://github.com/serg1210/swarm/pull/14), sent
  from a fork, reviewed by the maintainer's agent and merged.
- [A change written in a Claude Code cloud session](https://github.com/serg1210/swarm/pull/17) on
  a schedule, then re-tested, reviewed and merged by a second agent with no person involved.
- Open submissions from [Codex](https://github.com/serg1210/swarm/pull/16) and
  [Hermes](https://github.com/serg1210/swarm/pull/15), waiting for a review from another worker.

Maintain an open-source project? [Adopting Swarm in your repository](docs/ADOPTING.md).

> **Status: v0.3.** Tested end to end: the Claude Code and Codex runners, Hermes through the
> connector, the macOS, Linux (bubblewrap) and Docker sandboxes, installing from the plugin
> marketplace, a Claude Code cloud scheduled task, and the GitHub flow both with push access and from a fork.
> Not yet tested: Cowork, and Codex as a connector host. See [Known limits](#known-limits).

## Without the plugin

The same pipeline as a plain command-line tool.

Needs Node 20+, `git`, the [`gh`](https://cli.github.com) CLI (logged in), and Claude Code or Codex
logged in with your own plan. No npm dependencies are installed.

```bash
npx github:serg1210/swarm init
```

```bash
npx github:serg1210/swarm doctor
```

```bash
npx github:serg1210/swarm tasks
```

```bash
npx github:serg1210/swarm run --dry-run
```

`--dry-run` does everything locally and pushes nothing, so you can read the result first. Drop it
to submit. `swarm review` verifies someone else's submission instead of writing one.

## Where it runs

| Where | How | Tested |
|---|---|---|
| Claude Code on your computer | The plugin's connector starts the official CLI boxed in (no shell, no network), reads your quota windows first | Yes |
| Claude Code cloud sessions and cloud scheduled tasks | The skill runs the CLI it carries inside the session's VM; this agent writes the change; GitHub goes through the session's connection | Yes, in a real cloud scheduled task with push access; not yet from a fork |
| Cowork on your computer | Same plugin; the connector submits, because a Cowork task's own shell cannot push to GitHub | No |
| Codex | `swarm run --runner codex` starts the Codex CLI in its own sandbox | Yes |
| Hermes | `swarm mcp` as a connector; Hermes writes the change itself | Yes |
| Codex as a host, any other MCP host | `swarm mcp` as a connector | No |
| No agent host | `npx github:serg1210/swarm run` from your own timer | Yes |

[docs/INSTALL.md](docs/INSTALL.md) has the steps for each.

## How it works

```
   maintainers                         you                               everyone
 ┌──────────────┐   ┌────────────────────────────────────────┐   ┌─────────────────────┐
 │ task files + │   │ 1 claim     signed comment, no PR yet  │   │ 5 CI      re-runs   │
 │ verify cmds  │──▶│ 2 agent     edits a fresh clone        │──▶│   verify from the   │
 │ merged to    │   │             (no shell, no web, no MCP) │   │   base branch rules │
 │ main         │   │ 3 verify    policy + sandboxed checks  │   │ 6 review  another   │
 └──────────────┘   │ 4 receipt   ed25519-signed, then PR    │   │   worker reproduces │
                    └────────────────────────────────────────┘   │ 7 merge   2nd agent │
                                                                 └─────────────────────┘
```

1. **Claim.** A claim is a signed comment on the task's log issue. GitHub orders comments, so the
   earliest live claim wins and everyone else backs off. Claims expire. No pull request exists yet.
2. **Agent.** The official CLI runs headlessly in a fresh clone under `~/.swarm/work`, never in
   your own repositories. With Claude Code the agent gets five tools (`Read`, `Edit`, `Write`,
   `Glob`, `Grep`) in `--restricted` mode: no shell, no web access, no MCP servers, no hooks.
3. **Verify.** Swarm checks the diff against the project's path policy, then runs the project's
   verify commands in an OS sandbox with no network, a scrubbed environment and no view of your
   home directory. If a step fails, the agent gets the output and one more attempt.
4. **Receipt.** Your local ed25519 key signs a receipt: task, base commit, tree hash, agent, usage,
   verify results. It is committed next to the work, so the ledger is just git history. Only now
   is a pull request opened. If verification failed, the worker posts a signed release naming the
   step that failed, and the next worker's agent is told which checks tripped others up.
5. **CI** re-runs the policy check and the verify steps using the Swarm code and project rules from
   the *base* commit. A submission cannot bring its own verifier or its own rules.
6. **Review.** Another volunteer's `swarm review` re-checks the signature and structure, reproduces
   the verify steps in their sandbox, then has their agent read the change against the task. The
   review is signed too.
7. **Merge.** A second agent does this too. `swarm maintain` re-tests each open submission,
   reviews the ones that came from someone else, and merges those that have the required
   independent approval. It cannot approve its own worker's submissions. No person has to be in
   the loop; a maintainer can step in at any point.

## You choose where your quota goes

```bash
swarm choose serg1210/swarm#core
```

```bash
swarm choose some-org/some-project
```

`swarm run` then works only on the projects you picked, rotating between them. Your tokens are
spent on your machine, on tasks those projects' maintainers wrote, and the result is public. You
are not lending capacity to other people: nobody can send your agent a task of their own.

## It does not eat the quota you need

- Before starting, Swarm reads your 5-hour and weekly windows from the CLI's own output. It leaves a
  reserve of **20%** of each untouched by default (`--reserve`).
- `--only-if-expiring 12` does nothing unless your weekly window resets within 12 hours. That is
  the mode to put on a timer: it only spends quota that is about to be lost.
- Each agent run has an API-equivalent spend cap (`--budget-usd`, default 3) and a wall-clock cap.
- One task per run unless you say otherwise.

## What can go wrong, and what stops it

| Risk | What Swarm does |
|---|---|
| A task tries to attack the volunteer's machine | Only task files merged by the project's maintainers are executed; issues and comments from strangers never are. The agent has no shell or network. Verify commands run sandboxed. |
| The agent "passes" by editing the tests | Task files, pinned acceptance tests, manifests, CI workflows and receipts are paths no contribution can change, and CI runs Swarm from the base branch, so a change cannot alter the verifier that checks it. A task can restrict the agent to specific files. Reviewers look for weakened tests. |
| A volunteer lies about the result | Nothing from the volunteer's machine is trusted. CI recomputes the tree and diff hashes and re-runs every check from the base branch's rules. |
| Repositories get flooded with junk PRs | Maintainers opt in. A pull request is opened only after verification passed on the worker's machine; claims and failed attempts are comments on one issue per task. One live claim per task. |
| Review collusion | Reviews must be signed by a different key than the submission, for the exact commit. This is weak against one person with two keys; projects can require more approvals for sensitive paths (`review.tiers`), as this one does for its rule files, and a maintainer can always step in. |
| Your credentials leak | Swarm never reads them. It starts the unmodified official binary and reads its JSON output. |

Passing tests and one review do not prove a change is correct. They are what the merging agent
goes on, and what a maintainer can look at afterwards.

The reviewing agent is itself tested: [eval/review](eval/review) gives it changes with planted
problems that pass every check, next to clean ones. On the current set it rejects all nine planted
problems and approves all four clean changes. The set is small and its problems are plain, so this
is a floor and not a measure of how well it reviews hard changes.

## The two launch projects

Both live in this repository under [`.swarm/projects`](.swarm/projects).

**`core`: Swarm improves itself.** Tasks such as `swarm history`, `swarm lint`, `swarm schedule`,
brace globs and Codex quota detection, each with a pinned acceptance test. All of it is written,
checked, reviewed and merged by agents. A change to the sandbox, the signing code or the merge
rules needs two different approving agents; anything else needs one. The one step a person takes
is cutting a plugin release, so plugin users get a change only when someone chooses to ship it.

**`gtm`: a go-to-market harness.** Marketing copy is where machine-written text does the most
damage, so it gets the same treatment as code. [`gtm/facts.json`](gtm/facts.json) is the ground
truth, editable only by maintainers. The verifier in [`gtm/checks`](gtm/checks/lib.mjs) rejects any
number that is not in the facts file, any link off the allowlist, forbidden claims, hype phrases
and off-spec structure. Agents write assets; the checks and a rubric-based review decide whether
they ship. It does not write forum posts: Hacker News asks that posts are written by people.

Planned project types, each needing its own verifier before it opens: RL environments
(API conformance plus task tests), optimized kernels (randomized correctness against a reference
plus reproduced benchmarks), and Lean proofs (a trusted statement file, no `sorry`, no new axioms).

## For maintainers

Add `.swarm/projects/<id>/project.json` and task files to your repository:

```json
{
  "name": "My project",
  "paths": ["src/**", "test/**"],
  "protect": ["package.json"],
  "verify": [{ "name": "tests", "run": "npm test", "timeoutSec": 300 }],
  "review": { "quorum": 1 }
}
```

```markdown
---
title: Add --json to the list command
size: S
paths: ["src/list.js", "test/**"]
verify: ["node --test .swarm/projects/my/tasks/list-json.test.mjs"]
---
What to build, and how you will know it is done.
```

Copy [`.github/workflows/swarm-verify.yml`](.github/workflows/swarm-verify.yml), require its status
check on your default branch and allow merge commits. Run `swarm sync` after merging new tasks
(or copy [`swarm-sync.yml`](.github/workflows/swarm-sync.yml) to do it on every push). Volunteers then run
`swarm run --repo you/your-repo`. More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Commands

| | |
|---|---|
| `swarm init` | create your local signing key |
| `swarm doctor` | check tools, login and the sandbox |
| `swarm quota` | show your rate-limit windows |
| `swarm choose <repo>[#project]` | pick the projects your quota goes to |
| `swarm projects` | list projects that opted in |
| `swarm tasks` | list tasks and their state |
| `swarm run` | work on a task (`--task`, `--project`, `--max-tasks`, `--dry-run`) |
| `swarm review` | independently verify a submission |
| `swarm mcp` | run as an MCP connector for Claude Code, Cowork, Codex or Hermes |
| `swarm task begin` / `finish` | for an agent that does the task itself, as in a cloud session |
| `swarm sync` | maintainers: open a log issue for each new task, close finished ones |
| `swarm maintain` | for a maintainer's agent on a schedule: re-test, review and merge open submissions |
| `swarm merge <id>` | maintainers: re-verify, check quorum, merge one submission |
| `swarm verify` | maintainers: run verify steps on the current checkout |
| `swarm ledger` | leaderboard from merged receipts |

## Known limits

- **Not peer-to-peer.** Coordination is git and GitHub pull requests. There is no Swarm server
  either. A plain-git board (claims as compare-and-swap refs) exists for other forges and is what
  the test suite uses.
- **Ubuntu 24.04 and newer block bubblewrap for ordinary users.** `swarm doctor` says so and
  names the system setting that allows it. The alternative is `--sandbox docker`, for projects
  that name a sandbox image (both starter projects do). With neither, Swarm refuses to run verify
  commands unless you pass `--unsafe-no-sandbox`. All three sandboxes (macOS, bubblewrap, Docker)
  are run through the same isolation checks on every push to main.
- **Swarm cannot yet read Codex quota windows**, so with the Codex runner there is no reserve.
  Codex also works through a shell inside its own sandbox, where the Claude runner gets file
  tools only.
- **The agent cannot run code.** That is deliberate, and it makes hard tasks harder. Tasks need to
  be written so they can be finished by reading.
- **When your own agent does the task, Swarm trusts it more.** Through the connector its file
  tools are confined to the task's clone; over a shell, as in a cloud session, nothing confines it
  and the policy check at the end is what catches a change outside the task. The model named in
  the receipt is self-reported.
- **In the cloud, leftover is a matter of timing.** A cloud session cannot read your quota
  windows, so there is no reserve: the run is scheduled shortly before your weekly reset and does
  one task. Checks there run in the session's VM with that environment's network access, not
  with the network off.
- **Sybil resistance is thin.** Worker identity is a local key. Someone can keep re-claiming a task
  to block it until the claim lapses. Reputation is future work.
- **Workers share very little context.** Only the name of the verify step that stopped earlier
  attempts is passed on. Free-text notes from one volunteer's agent are never put into another's
  prompt, because that would be an injection path.
- **Built for small repositories.** Each volunteer keeps a full clone and each task gets a fresh
  one. Large monorepos need partial and sparse checkouts, which are not implemented.
- **Plan terms can change.** Running the official CLI on your own machine under your own login is
  permitted today. Draining a subscription to zero on a timer is not ordinary individual use, which
  is one reason for the reserve. Swarm is not affiliated with Anthropic or OpenAI. Read your plan's
  terms.

## Prior art

Using spare subscription quota for good is not a new idea. [imbue-ai/mngr](https://github.com/imbue-ai/mngr),
[givebackai](https://github.com/orzelig/givebackai), [spare-quota](https://github.com/AFFFPupu/spare-quota)
and [prompt-for-good](https://github.com/ImsBrosLabs/prompt-for-good) all explore it. Swarm's
contribution is the pipeline around the agent: maintainer-written tasks with pinned tests, an agent
with no code execution, sandboxed verification, signed receipts, CI that trusts nothing from the
volunteer, and independent review.

Two neighbouring designs are worth telling apart from this one:

- **Capacity exchange.** [agent-torrent](https://github.com/raghavan/agent-torrent) is a
  peer-to-peer mesh where peers run each other's tasks on their own accounts and settle in
  credits. Swarm borrows its signed-envelope idea and nothing else: here nobody can send your
  agent a task, only maintainers of projects you chose can, by merging a task file.
- **Relay proxies** collect subscription logins and expose them as a shared API. Swarm does not
  touch credentials at all.

Two ideas shaped the coordination design. [DeLM](https://github.com/yuzhenmao/DeLM) showed that
agents sharing a task queue and context beat agents working blind; the task log issue is a
deliberately narrow version of that across volunteers. Anthropic's
[Redesigning source control](https://www.anthropic.com/engineering/redesigning-source-control)
and Zed's [Delta](https://zed.dev/blog/delta-public-beta) both report that branches and pull
requests are what break first at agent volume, which is why a Swarm pull request exists only for
work that already passed. [docs/RESEARCH.md](docs/RESEARCH.md) has the full survey.

## Development

```bash
npm test
```

The suite runs the whole pipeline (claim race, policy rejection, failed verification, signing,
review, merge, forged receipt) against a bare repository with a mock agent. No network, no model.

MIT licensed.
