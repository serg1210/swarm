# Setting up Swarm

The user does one thing: choose a project. You do the rest without asking anything else, and
from then on Swarm runs in the background.

`SWARM` means `node "${CLAUDE_SKILL_DIR}/scripts/swarm/cli/swarm.mjs"`.

## 1. Choose a project: the only question

1. Get the briefing: call `swarm_brief`, or run `SWARM brief --json`. Its `choices` list has every
   project that opted in, with a short label and a description that includes how many tasks are
   open and an example.
2. Ask one question with this app's question or choice tool (AskUserQuestion in Claude Code; an
   interactive choice elsewhere): "Which project gets your leftover quota? Swarm then runs once
   a day in the background." One option per project, using `label` and `description` as given.
   If the app can only print text, list them and ask. The user may also name any repository that
   has a `.swarm` directory. Do not pick for them.
3. Save the choice: `swarm_choose`, or `SWARM choose owner/repo#project`.

Their answer is the go-ahead for everything below. Ask nothing more.

## 2. Check that this place can submit

Call `swarm_status` and read `canSubmit`, or run `SWARM doctor --repo owner/repo` and look for
the line "can submit to".

- **It can.** Continue with step 3.
- **It cannot.** Swarm does not run from this app, and nothing here should try. Say so in one
  line and stop: "Swarm can't submit to GitHub from here. It runs where you're signed in to
  GitHub: Claude Code, or the Code tab of the desktop app, on your computer." Do not schedule
  anything, do not do a task, and do not walk the user through fixing access.

Where Swarm can submit:

| | On the user's computer | Claude Code in the cloud |
|---|---|---|
| Runs when | The app is open and the computer is awake | Any time, laptop closed |
| How Swarm runs | The connector in this plugin, or the CLI | The CLI inside this skill, in the session's VM |
| Who edits code | The local `claude` CLI boxed in by Swarm, if installed; otherwise this agent | This agent |
| Knows the quota windows | Yes, and keeps a 20% reserve | No. Leftover is decided by when the run is scheduled |
| GitHub access | The user's `gh` login | The session's GitHub connection, only for repositories attached to it with write access |

A shell inside a Cowork task has no GitHub login of its own. Cowork can run Swarm only through
this plugin's connector (the `swarm_*` tools), and only when `canSubmit.ok` is true.

## 3. Schedule the daily run, without asking

Look at the scheduled tasks that already exist (this app's scheduled-task or routine tool). If
one already runs the swarm skill, leave it alone and skip to step 4. Never create a second one.

Otherwise create one, where this session runs:

**On the user's computer** (the connector is available, or `CLAUDE_CODE_REMOTE` is not `true`).
A local scheduled task, daily, at a time in the user's evening, with this prompt:

```
Run the swarm skill and do at most one task. This run is unattended: ask nothing. End with one
line: the pull request link, or why nothing was submitted.
```

Swarm reads the quota windows on every run and does nothing once the reserve is reached, so a
daily run is safe.

**In a Claude Code cloud session** (`CLAUDE_CODE_REMOTE` is `true`). A cloud scheduled task,
weekly, six to twelve hours before the weekly reset if the user's reset time is known from this
conversation, otherwise Sunday evening. A cloud run cannot see how much quota is left, so timing
is what makes it leftover. Attach the same repository this session has. Prompt:

```
Run the swarm skill for the project owner/repo#project and do at most one task. This run is
unattended: ask nothing. End with one line: the pull request link, or why nothing was submitted.
```

If this app has no way to create a scheduled task, skip this step and say so in the last line.

## 4. Do the first task now

Go back to the skill and do one run, so the user sees the checklist once.

## 5. One closing line

After the run's own one-line report, add one line and nothing else:

"Swarm now runs daily at <time>. Turn it off under Scheduled." (Or, when no schedule could be
created: "Swarm ran once. This app can't schedule it, so it runs when you ask.")

Do not explain quotas, reserves, costs or GitHub. Do not offer alternatives.
