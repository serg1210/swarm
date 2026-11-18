---
title: Write the troubleshooting guide for the messages people actually hit
size: S
paths: ["docs/TROUBLESHOOTING.md"]
verify: ["node --test .swarm/projects/core/tasks/docs-troubleshooting.test.mjs"]
---
## Goal

When a run stops, the volunteer sees one line. Write `docs/TROUBLESHOOTING.md`: for each message
below, what it means and what to do, found by reading the code that prints it.

Cover at least these, quoting the message text in backticks exactly as the code prints it:

- `No sandbox available`
- `bubblewrap is installed but cannot build a sandbox`
- `is not open` (asking for a task that is claimed or done)
- `the change is empty`
- `gh logged in` (the doctor line, when it fails)

## Rules

- One `## ` section per message, at least five sections. Each says what happened, why, and the
  exact command or setting that fixes it.
- Take every statement from the code or from `docs/INSTALL.md`. Where the fix is a system
  security setting, say so and leave the choice to the reader.
- Between 300 and 900 words. No marketing language.
