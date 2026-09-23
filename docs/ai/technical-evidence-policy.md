---
Title: Technical Evidence Prompt Policy Gates
Description: Local regression and egress checks for source-neutral technical prompts.
Last Updated: 2026-09-23
---

# Technical Evidence Prompt Policy Gates

The policy layer provides two deterministic local checks for the technical
evidence prompt envelope.

## Prompt regression

`technical-evidence regression` compares a baseline and candidate by their
opaque context and prompt fingerprints. It reports bounded changes such as a
different objective, completeness state, warning set, token limit, or prompt
identity.

The check blocks when a candidate loses completeness, discards an existing
warning, or omits a required prompt boundary guard. A changed but safe prompt
is marked `reviewRequired`; it is never silently accepted as identical.

```text
node cli/zeus.js technical-evidence regression \
  --baseline <relative-prompt> \
  --candidate <relative-prompt> \
  --out <relative-regression> --json
```

## Local-only egress

`technical-evidence policy-check` validates the prompt envelope and evaluates
the intended trust zone and destination. Only `local` plus
`local-workspace` is allowed. `private-network` and `external-provider` are
blocked, even when a caller asks for them explicitly.

```text
node cli/zeus.js technical-evidence policy-check \
  --prompt <relative-prompt> \
  --trust-zone local \
  --destination local-workspace \
  --out <relative-egress-check> --json
```

Both results are read-only, workspace-bounded, and fingerprint-only. They do
not call providers and never authorize publication, promotion, deployment, or
mutation.
