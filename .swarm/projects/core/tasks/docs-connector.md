---
title: Write the reference for the Swarm connector's tools
size: S
paths: ["docs/CONNECTOR.md"]
verify: ["node --test .swarm/projects/core/tasks/docs-connector.test.mjs"]
---
## Goal

`swarm mcp` exposes Swarm to any agent host as a set of tools. Their only documentation is the
descriptions in `src/mcp.mjs`. Write `docs/CONNECTOR.md`, a reference a person can read before
letting their agent use them.

## Rules

- Sections, with these exact headings: `## Setup`, `## Delegate mode`, `## Connector mode`,
  `## What the file tools refuse`.
- Every tool in the `TOOLS` list of `src/mcp.mjs` appears under the mode it belongs to, with its
  name in backticks, what it does in one or two sentences, and its required arguments.
- Take every statement from the code (`src/mcp.mjs`, `src/session.mjs`) or from
  `docs/INSTALL.md`. Do not describe behaviour you did not find there.
- Between 300 and 900 words. Plain, specific prose; no marketing language.
