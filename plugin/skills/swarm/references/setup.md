# Setting up Swarm

Three things to settle with the user, in this order. Ask, do not assume.

`SWARM` means `node "${CLAUDE_SKILL_DIR}/scripts/swarm/cli/swarm.mjs"`.

## 1. Choose a project

1. Get the briefing: call `swarm_brief`, or run `SWARM brief --json`. Its `choices` list has every
   project that opted in, with a short label and a description that includes how many tasks are
   open and an example. Show the second line of `steps` (the quota) first, so the user knows what
   they have to give. Keep everything you say here to short lines.
2. Let the user pick, with this app's question or choice tool (AskUserQuestion in Claude Code; an
   interactive choice elsewhere), one option per project using `label` and `description` as
   given. If the app can only print text, list them with their descriptions and ask. The user may
   also name any repository that has a `.swarm` directory. Do not pick for them.
3. On the user's own computer, save the choice: `SWARM choose owner/repo#project` (or the
   `swarm_choose` tool). In a cloud session nothing is saved between runs, so the choice goes into
   the scheduled task's prompt instead (step 3).
4. Show what is open there: `SWARM tasks --repo owner/repo`.

## 2. Decide where the runs happen

| | On the user's computer | In the cloud |
|---|---|---|
| Runs when | The app is open and the computer is awake | Any time, laptop closed |
| How Swarm runs | The connector in this plugin, or the CLI | The CLI inside this skill, in the session's VM |
| Who edits code | The local `claude` CLI boxed in by Swarm, if installed; otherwise this agent | This agent |
| Knows the quota windows | Yes, and keeps a 20% reserve | No. Leftover is decided by when the run is scheduled |
| GitHub access | The user's `gh` login | The session's GitHub connection, for repositories attached to the task |

Cloud means Claude Code cloud sessions and cloud scheduled tasks (claude.ai/code, or the Code tab
with a cloud environment). A Cowork task's own shell cannot push to GitHub, so in Cowork the
plugin's connector does the submitting, which needs a session that runs on the user's computer.

Both draw on the same plan. Tell the user which they are getting and what it means.

## 3. Schedule the leftover run

"Leftover" means quota that would otherwise lapse when the weekly window resets.

**Find the reset time.** On the user's computer run `SWARM quota --json` and read
`weekly.resetsAt`. Elsewhere ask the user to read it at claude.ai/settings/usage.

**On the user's computer.** Create a local scheduled task (in the Claude desktop app; not a cloud
one) that runs daily with this prompt:

```
Run the swarm skill and do at most one task. If Swarm says the quota reserve is reached or
nothing is open, report that in one line and stop.
```

The connector reads the quota windows on every run and does nothing when the reserve is reached,
so a daily run is safe.

**In the cloud.** Create a cloud scheduled task (`/schedule` in a local Claude Code session, or
claude.ai/code/routines) with:

- **Repository:** the chosen project's repository if the user can push to it; otherwise the user's
  fork of it plus the project's repository, with the environment variable `SWARM_FORK` set to
  `user/fork`.
- **Environment:** the default one is enough; Swarm needs only GitHub and nothing else.
  Optionally set `SWARM_HANDLE` to the user's GitHub login, and `SWARM_IDENTITY` to the output of
  `SWARM identity export` run on their computer, so every run signs as the same worker.
- **Schedule:** weekly, six to twelve hours before the weekly reset. A cloud run cannot see how
  much quota is left, so timing is what makes it leftover. Offer a second run a day earlier only
  if the user says they usually have a lot to spare.
- **Prompt:**

```
Run the swarm skill for the project owner/repo#project and do at most one task. Report the
pull request link, or in one line why nothing was submitted.
```

Before creating anything, tell the user: it does one task per run; a cloud run that starts when
the plan limit is already reached is simply rejected; pull requests and comments appear under
their GitHub account. Create the schedule only after they say yes.
