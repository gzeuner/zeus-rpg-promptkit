---
Title: ZPI Test Strategy Baseline
Description: Minimum deterministic acceptance matrix for later Zeus Project Intelligence implementation packages.
Last Updated: 2026-07-22
---

# ZPI Test Strategy Baseline

ZPI-01 is documentation-only. Its job is to freeze the acceptance matrix for later implementation
packages, not to claim runtime coverage.

## Principles

- preserved source evidence is authoritative; retrieval and context layers are derived aids
- full rebuild and incremental refresh must converge on the same published semantics
- fail-closed reason codes are part of the contract surface
- privacy, redaction, and safe-sharing behavior are tested as safety controls, not cosmetic output
- Package 09 remains closed; no live IBM i dependency enters ZPI runtime packages

## Minimum test matrix

### Unit tests

Required unit coverage before runtime rollout:

- valid and invalid contract fixtures for projects, snapshots, source units, evidence, provenance,
  diagnostics, and context packages
- canonical path and content-hash normalization rules
- closed enums and reason-code validation
- corruption detectors for content-hash mismatch, malformed metadata, and index integrity checks
- single-writer lock behavior and stale-lock handling policy
- deterministic diff planning for add, change, delete, and unchanged inputs
- deterministic token-budget and omission-manifest calculations
- redaction helpers for host paths, secret-like values, and forbidden source classes

### Contract tests

Community-owned contract tests must later cover:

- exact schema validation and explicit unknown-version failure
- snapshot publish semantics and current-pointer behavior
- migration-open refusal on unknown future required versions
- retrieval result envelopes, bounds, and ordering rules
- context-package evidence references, non-claims, and omission reporting
- absence or denial behavior for optional Commercial capabilities
- public-claims consistency so docs do not imply Package 09 reopen or live IBM i support

### Integration tests

Use a pinned synthetic corpus only. Required integration themes:

- create, publish, reopen, and query a Community-owned snapshot
- atomic publish and rollback behavior for interrupted writes
- path traversal and symlink or junction escape refusal under trusted roots
- corrupt or partially published search state refusal or documented rebuild path
- full rebuild versus incremental semantic equivalence
- deterministic retrieval hit ordering for a pinned snapshot and query
- bounded context-package assembly with explicit omission reasons
- Community-only operation when no Commercial module is registered

### Adversarial tests

High-severity adversarial themes that must become release gates:

- project-ID or path escape attempts
- stale current-pointer or mixed-generation reads
- forged provenance or `VERIFIED` facts without matching evidence
- secret or absolute-path leakage through diagnostics, search snippets, MCP, or exports
- partial index publish presented as complete current data
- entitlement denial mid-operation with no partial capability success
- token-budget compliance without unsafe disclosure fallback

## Acceptance criteria for later packages

ZPI implementation packages must not advance without:

- a closed reason-code catalog exercised by tests
- a published equality definition for full-rebuild and incremental equivalence
- a documented retrieval tie-break and analyzer identity policy
- a documented serve-during-write policy
- reproducibility guidance identifying which metadata is canonical and which is observational only

## External review inputs captured in ZPI-01

This matrix incorporates independent Grok review themes for:

- determinism and ordering risks
- path, symlink, and oversized-input failure modes
- entitlement-boundary regression risks
- redaction and disclosure controls
