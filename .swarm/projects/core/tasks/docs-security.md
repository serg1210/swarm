---
title: Write the security page: what Swarm protects against and what it does not
size: S
paths: ["docs/SECURITY.md"]
verify: ["node --test .swarm/projects/core/tasks/docs-security.test.mjs"]
---
## Goal

A volunteer runs code that an agent wrote, and a maintainer receives pull requests from strangers'
machines. Both need one page that says plainly what stands between them and harm. Write
`docs/SECURITY.md` from `docs/ARCHITECTURE.md`, `README.md` (Known limits) and the code.

## Rules

- Sections, with these exact headings: `## What Swarm protects against`,
  `## What it does not protect against`, `## Reporting a vulnerability`.
- The first section covers, for the volunteer and for the maintainer: the sandbox for verify
  commands (seatbelt, bubblewrap, Docker), what the agent can and cannot do with each runner,
  signed receipts (ed25519), rules and verifier taken from the base branch in CI, and files that
  a contribution may never change.
- The second section is at least as concrete as the first. It must include prompt injection
  against the reviewing agent, a volunteer's own agent working over a shell, and that passing
  checks and a review do not prove a change is correct.
- "Reporting a vulnerability" asks for a private GitHub security advisory on the repository and
  not a public issue.
- State only what the code or those documents support. Between 350 and 900 words.
