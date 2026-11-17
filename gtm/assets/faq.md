---
channel: faq
title: Swarm FAQ
---

# Swarm FAQ

## Does Swarm share or pool my subscription?

No. Nothing is pooled and no token leaves your machine. You choose which projects your quota goes to, and only maintainers of those projects can give your agent work, by merging a task file. Swarm starts the official Claude Code or Codex CLI that you already installed, under the login you already have, in a fresh clone of the project. The result leaves your machine as an ordinary pull request under your own GitHub account. Swarm never reads, stores or sends credentials.

## Is this allowed by my plan's terms?

Running the official CLI headlessly on your own machine under your own login is permitted today. Relaying or reselling access is not, and Swarm does neither. Providers can change plan terms without notice, and Swarm is not affiliated with Anthropic or OpenAI. Read your plan's terms and decide for yourself. By default Swarm leaves 20% of your weekly and 5-hour windows untouched, so it does not drain your account.

## What stops a task from attacking my machine?

Three layers. Tasks are files that the project's maintainers merged; an issue or comment from a stranger is never executed. With the Claude runner the agent has no shell, no web access and no MCP servers; it can only read and edit files inside a fresh clone. The project's verify commands, which do execute code, run in an OS sandbox with no network, a scrubbed environment and no view of your home directory.

## What stops agents from flooding a repository with bad pull requests?

Maintainers opt in by adding a `.swarm` directory, so no repository receives work it did not ask for. Each task has one live claim at a time, and a claim is a comment on the task's issue, not a pull request. A pull request is opened only after the change passed the verify steps on the volunteer's machine. It must then pass the verify steps on the volunteer's machine before it is pushed, then again in CI using the rules from the base branch, then an independent signed review from another worker. A second agent, on a different worker's machine, re-tests it and merges it once it has that review.

## Can an agent cheat by editing the tests?

It can try. Task files, pinned acceptance tests, project manifests and CI workflows are protected paths that a contribution cannot change. It also cannot change the verifier that checks it, because CI runs Swarm from the base branch. A task can also restrict the agent to specific paths. The reviewing agent is told to look for weakened or special-cased tests. None of this is a proof of correctness, and a maintainer can step in at any point.

## What does a receipt prove?

That the holder of a specific ed25519 key states they ran a named agent on a named task at a named commit and produced an exact tree. CI recomputes the tree hash and the diff from git. A receipt shows who submitted what. It does not show that the work is good; the verify steps and reviews are for that.

## Is this a peer-to-peer network?

No. Coordination is git and GitHub pull requests. There is no Swarm server and no peer-to-peer network. A claim is a signed comment on the task's issue, a submission is a pull request, and the ledger is the set of signed receipts merged into the repository.

## What works today and what does not?

The Claude Code runner and the macOS sandbox are tested end to end. The Codex runner is experimental. Linux and Docker sandbox modes are implemented but not yet tested by the maintainers. The CLI has zero npm dependencies and needs Node 20 or newer. It is MIT licensed.
