---
title: Write the objections page: the hardest questions, answered straight
size: S
paths: ["gtm/assets/objections.md"]
---
## Goal

Write `gtm/assets/objections.md`. A sceptical developer reads the pitch and thinks of reasons it
will not work or should not exist. Answer the six hardest ones as question headings, each in a
short paragraph that concedes what is true before it answers.

Include at least these: whether this breaks a provider's terms, whether it floods maintainers
with machine-written pull requests, whether a volunteer's machine is safe, whether passing checks
means the change is right, why anyone would give quota away, and what happens when nobody reviews.

## Rules

- Frontmatter: `channel: objections` and a `title`.
- Read `gtm/channels/objections.json` for length and the number of question headings.
- Every factual statement must come from `gtm/facts.json`. If a fact you want is not there, leave
  it out. No numbers, adoption figures or testimonials that are not in the facts.
- Where the honest answer is "it does not", say that. `gtm/checks/lib.mjs` lists the phrases the
  verifier rejects.
