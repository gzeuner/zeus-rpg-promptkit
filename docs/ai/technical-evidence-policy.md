---
Title: Technical Evidence Prompt Policy Gates
Description: Local regression and egress checks for source-neutral technical prompts.
Last Updated: 2026-09-24
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

## Fingerprint-only bundles

`technical-evidence bundle` creates a local manifest that binds the exact
context, prompt, regression result, and egress result. The manifest contains
only contract references, schema versions, opaque fingerprints, bounded gate
projections, and fixed privacy constraints. It never copies prompt content or
source-derived values.

The bundle is ready only when the regression and local egress gates pass. The
bundle itself never enables provider handoff, publication, promotion, or
deployment.

## Local handoff receipts

`technical-evidence handoff` combines a ready bundle with a fresh review check
whose policy is `required`. An accepted receipt is bound to the bundle and
review fingerprints and can be retained as local evidence that the exact
artifact set was reviewed. Advisory or missing review state remains blocked.

The receipt contains no reviewer name and no prompt content. Its destination
is the fixed local review boundary; external publication and provider handoff
remain disabled.
