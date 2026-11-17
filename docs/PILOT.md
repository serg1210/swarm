# Pilot test

A first test with people other than the author. So far everything has been run from one GitHub
account with push access to the repository, which means the path every outside volunteer takes
has never been exercised. That is what this pilot is for.

## For testers

It takes about 20 minutes. You need Claude Code with a paid plan, Node 20 or newer, `git`, and the
[`gh`](https://cli.github.com) CLI logged in (`gh auth status`).

**Before you start, know what it does.** Swarm will:

- create a folder `~/.swarm` on your machine (a signing key, clones of the project);
- fork `serg1210/swarm` on your GitHub account;
- post a comment on a public task issue and open a public pull request, both under your name;
- spend a small amount of your Claude quota. Our own two runs cost $0.07 and $0.11
  API-equivalent on Sonnet. Each run is capped at $3 and does one task.

It does not read your Claude credentials, and the agent that writes the change has no shell and
no network. To remove everything afterwards: `/plugin uninstall swarm`, delete `~/.swarm`, and
delete the fork on GitHub.

### 1. Install

In Claude Code:

```
/plugin install swarm --marketplace serg1210/swarm
```

If that fails, note the message and use the fallback so you can still test the rest:

```bash
npx -y github:serg1210/swarm doctor
```

### 2. Set up and choose a project

Say: **set up Swarm**

You should be shown the projects that opted in and asked to choose. Pick either one. Say no to
scheduling for now.

### 3. One donation run

Say: **donate quota with Swarm**

Expect a few minutes. It should end with a pull request link. Open the link and check that the
pull request is from your fork and that a check called `verify` appears on it. The check may wait
for the repository owner to approve it, because it is your first contribution here; that is
GitHub's rule, not a failure.

Fallback without the plugin:

```bash
npx -y github:serg1210/swarm run
```

### 4. Review someone else's submission

Once a colleague's pull request exists, say: **review a Swarm submission**

Swarm reruns the project's checks on your machine, has Claude read the change, and posts a signed
review as a comment. This is the first time a review will come from a genuinely different person.

### 5 and 6. Optional: scheduled runs

Only if you want to. Say **schedule Swarm** and follow it for a daily run on your computer, or
follow "Claude Code in the cloud" in [INSTALL.md](INSTALL.md) for a cloud run. The cloud path has
never been run for real, so a failure there is expected information.

### Report

One report each, whatever happened:
[open a pilot report](https://github.com/serg1210/swarm/issues/new?template=pilot-report.yml).
It asks what you tried, where it stopped, and for Swarm's output.

## For the person running the pilot

**Before inviting people**

- Do not add testers as collaborators on the repository. Without push access they exercise the
  fork path, which is the point. One tester with push access is enough as a comparison.
- Five to eight people is the useful size: nine tasks are open, and each run takes one until it
  merges.
- Decide who tries the cloud run. One or two people is enough.

**While it runs**

- GitHub holds the `verify` workflow on a first-time contributor's pull request until you click
  **Approve and run** on that pull request. Check for held runs, or testers will see no check.
- Let an agent handle review and merging: this re-tests every open submission, reviews the ones
  from other people, and merges those with an independent approval.

```bash
npx -y github:serg1210/swarm maintain
```

- Reports arrive as issues titled `[pilot]`.

**What a pass looks like**

| Question | How you will know |
|---|---|
| Does the plugin install from the marketplace? | Step 1 reports |
| Does "set up Swarm" lead someone to a chosen project without help? | Step 2 reports, and the "confusing" field |
| Does a run from a fork end in a pull request? | Pull requests whose head is a tester's fork |
| Does CI pass on a fork pull request? | The `verify` check on those pull requests |
| Do two people racing for a task both end well? | One claims, the other is told and gets a different task |
| Does an independent review work? | A signed review comment from a different person than the submitter |
| Does it work on Linux and on Windows with WSL? | Operating system field; only macOS is tested so far |
| What does it cost people on their default model? | The "Session:" line in pasted output |
| Does a cloud run work at all? | Step 6 reports |

**Known gaps going in**

- Submitting from a fork: written, never run.
- Linux sandbox (bubblewrap): written, never run. On Linux without bubblewrap Swarm refuses to
  run a project's checks; that refusal is correct behaviour and worth a report.
- Windows without WSL: not supported.
- Cloud sessions: run only on a laptop standing in for one.
