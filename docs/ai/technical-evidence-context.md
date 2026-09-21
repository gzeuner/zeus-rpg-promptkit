---
Title: Technical Evidence Context Contract
Description: Generic local-only prompt projection for already-anonymized technical evidence.
Last Updated: 2026-09-21
---

# Technical Evidence Context Contract

The `zeus.technical-evidence-context` contract is the reusable Promptkit
boundary between anonymized technical evidence and local prompt construction.
It does not read source material. It accepts an already-anonymized evidence
graph and emits a bounded local context package.

## CLI discovery

Use the CLI help as the authoritative option source:

```text
node cli/zeus.js technical-evidence context --help
```

The route is local-only. Input and output files must be relative workspace
artifacts. The input must have a read-only boundary, closed privacy flags,
opaque identifiers, bounded technical tokens, and no unsupported fields.

## Context guarantees

The projection contains only:

- generic node and relation kinds;
- opaque identifiers and bounded technical metadata;
- deterministic node/edge/token limits;
- explicit completeness, warning codes, and omission codes;
- a stable context fingerprint for local reproducibility.

It never accepts or emits source text, source paths, source names, credentials,
business terms, private mappings, or free-form source-derived explanations.
Unknown fields fail closed. Incomplete evidence remains incomplete; the
projection never fills scanner gaps with guesses.

## Prompt boundary

Downstream prompt and investigation features may consume this context as
technical relationship evidence only. The contract explicitly makes no claim
about business meaning, ownership, process descriptions, or private mappings.
Process candidates and reviewed process answers require separate sanitized
fixtures and explicit review contracts.

## Public artifact boundary

The public repository contains this generic contract, synthetic fixtures, and
structural guards. Runtime-derived contexts, metrics, fingerprints, warning
instances, and local references remain local-only and must not be committed,
published, or included in releases.
