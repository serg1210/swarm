---
title: Publish a JSON Schema for receipts
size: S
paths: ["docs/receipt.schema.json", "test/**"]
verify: ["node --test .swarm/projects/core/tasks/receipt-schema.test.mjs"]
---
## Goal

Receipts are Swarm's public record, and other tools will want to read them. Describe the format
once, as a JSON Schema, from `buildReceipt` in `src/receipt.mjs` and the receipts already merged
under `.swarm/receipts/`.

## Acceptance

- `docs/receipt.schema.json` is a JSON Schema (draft 2020-12) for an object, with a `title` and a
  `description`.
- `required` lists only fields that are present in every merged receipt, and includes `v`, `kind`, `project`,
  `task`, `base`, `work`, `tree`, `diffSha256`, `agent`, `usage`, `verify`, `ts`, `signer` and `sig`.
- `properties` describes every top-level field that appears in any merged receipt. Every
  property, at the top level and inside `agent`, `usage` and `signer`, has a `type` and a
  one-sentence `description` saying what it records.
- `signer` requires `id`, `handle` and `publicKey`.
- Do not change any receipt, and do not add a dependency. A schema validator is not needed: the
  test checks structure.
