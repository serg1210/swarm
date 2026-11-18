---
title: Write the glossary
size: S
paths: ["gtm/assets/glossary.md"]
---
## Goal

Write `gtm/assets/glossary.md`. Someone opens a Swarm pull request for the first time and meets
words used in a particular sense. Define each one in two or three sentences: what it is, who
creates it, and where it lives.

## Rules

- Frontmatter: `channel: glossary` and a `title`.
- Read `gtm/channels/glossary.json` for length and the required entries. Each entry is a `## `
  heading. You may add entries (for example Worker, Verify step, Sandbox, Quorum) within the length.
- Define terms from `gtm/facts.json`, `docs/ARCHITECTURE.md` and the code. Do not define a term by
  using another term before that one has been defined.
- Every factual statement must come from `gtm/facts.json` or the repository.
