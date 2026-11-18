---
channel: glossary
title: Swarm glossary
---

# Swarm glossary

The words below have a particular sense in a Swarm pull request. Each entry builds only on the ones above it.

## Worker

One volunteer's installation of Swarm, identified by an ed25519 key that Swarm generates on the volunteer's machine. The private key stays under `~/.swarm`. The fingerprint of the public key is the worker id that appears in everything the worker signs.

## Task

A file describing one piece of work a project wants done. The project's maintainers write it and merge it under `.swarm/projects/<id>/tasks/` on the default branch. Only merged task files are ever turned into a prompt for an agent.

## Claim

A signed statement that a worker has started on a task, so that two workers do not do the same work. The worker creates it as a comment on the task's GitHub issue, which a maintainer opened. The earliest live claim wins, and by default it lapses after 90 minutes.

## Sandbox

The operating-system isolation in which a project's commands are run: no network, a scrubbed environment and no view of the home directory. Swarm sets it up on the machine doing the checking, using seatbelt on macOS, bubblewrap on Linux, or Docker.

## Verify step

A named shell command that decides whether a change is acceptable, such as a test run. Maintainers list the steps in the project manifest, `.swarm/projects/<id>/project.json`, or in a task file. Swarm runs each step in the sandbox.

## Receipt

A signed record of one finished attempt: task, base commit, tree hash, agent, usage and the result of each verify step. The worker creates and signs it after the steps pass on its own machine. It is the single file added by the last commit of the pull request, at `.swarm/receipts/<project>/<task>/<worker>.json`.

## Review

A signed verdict, approve or reject, on a receipt's pull request. A different worker creates it after re-running the verify steps and reading the change; a worker's review of its own work never counts. It lives as a comment on the pull request.

## Quorum

The number of approving reviews from different workers that a pull request needs before it is merged. Maintainers set it in the project manifest and can ask for more on sensitive paths. It is read from the base commit, so a change cannot lower its own bar.

## Ledger

The set of receipts merged into the default branch. Nobody writes it separately: it grows each time a pull request is merged. A task is done when a receipt for it exists there.
