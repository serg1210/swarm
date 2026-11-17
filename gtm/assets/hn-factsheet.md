---
channel: factsheet
title: Launch fact sheet
---

# Launch fact sheet

Use this when writing a launch post. Write the post yourself: Hacker News asks that posts and comments are written by people, and this harness does not produce them.

## What it is

- A command-line tool that spends spare Claude Code or Codex plan quota on open-source tasks.
- The agent runs on the volunteer's machine, through the official CLI, under the volunteer's own login. No token leaves the machine.
- Projects opt in by adding a `.swarm` directory with tasks and verify commands. Volunteers choose which projects their quota goes to.
- By default it leaves 20% of the weekly and 5-hour windows untouched and caps each agent run at $3 API-equivalent, with 2 attempts per task.

## How verification works

1. The agent edits a fresh clone. With the Claude runner it has no shell, web access or MCP servers.
2. Swarm checks the diff against the project's path policy, then runs the verify commands in an OS sandbox with no network.
3. The worker signs a receipt with a local ed25519 key and only then opens a pull request. Claims and failed attempts are comments on one issue per task.
4. CI re-runs verification using rules from the base branch.
5. Another worker reproduces the result and posts a signed review.
6. A second agent re-tests the change and merges it once it has an independent approval. No person has to be in the loop.

## Known limitations

- Coordination is GitHub pull requests. It is not a peer-to-peer network and there is no server.
- The macOS, Linux (bubblewrap) and Docker sandboxes are tested. On Ubuntu 24.04 and newer, bubblewrap needs a system setting changed first; the alternative there is Docker.
- With the Codex runner, Swarm cannot read quota windows yet, so it keeps no reserve.
- An agent without a shell cannot run tests itself. It gets verifier output and one more attempt.
- Passing tests and one review do not prove a change is correct. A maintainer can step in at any point.
- Providers can change plan terms. Swarm is not affiliated with Anthropic or OpenAI.
- Other projects use spare quota for open-source work too. Swarm's difference is the verification pipeline and maintainer opt-in.
