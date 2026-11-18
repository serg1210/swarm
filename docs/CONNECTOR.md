# The Swarm connector

`swarm mcp` speaks JSON-RPC over stdio, so any MCP host can drive Swarm through the tools below.
In delegate mode Swarm starts the Claude Code or Codex CLI in the background. In connector mode
the host's own agent edits files itself. Either way Swarm does the claim, the policy check, the
sandboxed verification, the signed receipt and the pull request.

## Setup

Point the host at the command `swarm mcp` (after `npm install -g github:serg1210/swarm`) or at
`npx -y github:serg1210/swarm mcp`. Verification can take minutes, so raise the host's tool
timeout where it has one; `docs/INSTALL.md` uses 900 seconds for Codex and Hermes.

These tools belong to neither mode. None has a required argument except `swarm_job`.

- `swarm_status` reports the worker identity, chosen projects, agent CLIs found, sandbox, GitHub
  login, any unfinished session or running job, and `canSubmit`. Call it first. If `canSubmit.ok`
  is false, start no task.
- `swarm_brief` returns what to show the user before quota is spent: the quota left, the one task
  the next run would do, and the other projects they could choose. It reads the Claude plan
  windows with one small request unless `probe_quota` is false.
- `swarm_choose` shows, adds or removes the projects the user's quota goes to. With no `repo` it
  only lists them.
- `swarm_tasks` lists tasks and their state (open, claimed, done, unpublished) in the chosen
  projects or in one repository.
- `swarm_job` returns the state, exit code and last 40 log lines of a background job. For a
  donate run it also reports progress. Required: `job`.

## Delegate mode

These tools start a background job and return a job id at once; poll `swarm_job` every 30 to 60
seconds until its state is "finished". Only one job runs at a time: starting another returns the
status of the one already running. All need an agent CLI (`claude` or `codex`) on the machine.
None has a required argument.

- `swarm_donate` starts a run in which the agent CLI works on a task, boxed in with no shell and
  no network, and Swarm verifies and submits the result. Without `task` it picks an open task at
  random; it stops after one task unless `max_tasks` (up to 5) says otherwise.
- `swarm_review` starts an independent review of someone else's submission: verification is
  reproduced in the sandbox, then the agent CLI reads the change.
- `swarm_maintain` runs the maintainer's pass: every open submission in the project is re-tested,
  reviewed if it came from someone else, and merged once it has the required independent
  approval. It never approves this worker's own submissions, and it needs push access to the
  project.

## Connector mode

The host agent does the task itself. It is given no path on disk, only a session id and file
tools that reach that session's fresh clone.

- `swarm_begin` claims an open task and prepares a clone. It returns the task, its allowed paths,
  its verify steps, instructions and a session id. One session exists at a time; an unfinished
  one is resumed. If a result could not be submitted from this machine, nothing is claimed. No
  required arguments; `agent` and `model` are recorded in the receipt as self-reported.
- `swarm_list` lists up to 2000 files in the clone, optionally under a directory. Required:
  `session`.
- `swarm_read` reads a text file, 2000 lines by default, starting at `offset`. Required:
  `session`, `path`.
- `swarm_search` searches file contents for fixed text, or an extended regular expression when
  `regex` is true, and returns up to 200 matches as path:line:text. Required: `session`,
  `pattern`.
- `swarm_write` creates or overwrites a file with the given contents. Required: `session`,
  `path`, `content`.
- `swarm_edit` replaces exact text in an existing file. The text must appear exactly once unless
  `replace_all` is set. Required: `session`, `path`, `old_text`, `new_text`.
- `swarm_delete` deletes a file. Required: `session`, `path`.
- `swarm_finish` checks the change against the project's policy and runs its verify steps in the
  sandbox. If they pass it signs a receipt and opens the pull request. If something fails it
  returns the output so the agent can fix it and call again, three attempts in all. Required:
  `session`, `summary`.
- `swarm_abandon` gives the task back without submitting anything. Required: `session`.

If a verified change cannot be submitted right away, Swarm keeps it and submits it at the start
of its next run.

## What the file tools refuse

Every file tool refuses:

- a session that does not exist or is no longer active;
- an absolute path;
- a path that leaves the repository through `..` or through a symlink;
- any path with a `.git` component.

`swarm_write`, `swarm_edit` and `swarm_delete` also refuse:

- files the project protects;
- paths outside the ones the task may touch;
- a target that exists and is not a regular file;
- a result larger than 1 MB (writing and editing).

`swarm_edit` also refuses a file that does not exist and text that is not found.
