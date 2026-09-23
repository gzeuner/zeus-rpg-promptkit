---
Title: Technical Evidence Prompt Adapter
Description: Local-only, source-neutral prompt construction and review receipts.
Last Updated: 2026-09-23
---

# Technical Evidence Prompt Adapter

The technical evidence prompt adapter is a narrow, local-only Promptkit
surface. It consumes the versioned technical evidence context contract and
produces a deterministic prompt envelope for technical relationship review.

It accepts only:

- an approved technical objective code;
- opaque identifiers and bounded technical tokens;
- generic node and relationship kinds;
- bounded warning codes and omissions;
- the context fingerprint and explicit completeness state.

It does not accept free-form project names, paths, content, credentials, or
business terms. The generated prompt states the same boundary and preserves
incompleteness and warnings so a consumer cannot mistake a partial projection
for a complete one.

## CLI

```text
node cli/zeus.js technical-evidence context --input <relative-graph> --out <relative-context> --json
node cli/zeus.js technical-evidence prompt --context <relative-context> --out <relative-prompt> --json
```

All input and output files must be relative to the current workspace. The
command emits relative artifact labels only. The prompt adapter is local-only
and does not contact a provider.

## Local review receipt

Create a receipt for an exact prompt artifact:

```text
node cli/zeus.js technical-evidence review \
  --context <relative-context> \
  --prompt <relative-prompt> \
  --decision <approve|reject|defer> \
  --reviewer <local-reviewer> \
  --out <relative-receipt> --json
```

Check it before using the prompt in a local workflow:

```text
node cli/zeus.js technical-evidence review-check \
  --context <relative-context> \
  --prompt <relative-prompt> \
  --receipt <relative-receipt> \
  --policy required --json
```

Receipts bind the exact context and prompt fingerprints. The reviewer value is
represented only by a bounded hash. Receipts never authorize promotion,
deployment, mutation, or external publication. A required check blocks when a
receipt is missing, mismatched, rejected, future-dated, or stale.

Use synthetic fixtures for tests and examples. Keep local runtime artifacts
outside committed or shared documentation.

## Regression and egress gates

Compare two local prompt envelopes before accepting a candidate:

```text
node cli/zeus.js technical-evidence regression \
  --baseline <relative-prompt> \
  --candidate <relative-prompt> \
  --out <relative-regression> --json
```

The result is `pass` when the envelopes are equivalent, `changed` when a
bounded difference requires local review, and `blocked` when a completeness
regression, discarded warning, or missing boundary guard is detected. The
result contains fingerprints and stable codes, never prompt content.

Before any handoff, run the local-only egress check:

```text
node cli/zeus.js technical-evidence policy-check \
  --prompt <relative-prompt> \
  --trust-zone local \
  --destination local-workspace \
  --out <relative-egress-check> --json
```

Only the local workspace is allowed. Private-network and external destinations
are blocked by the contract; provider handoff and external publication remain
disabled.
