---
Title: ADR-011 Evidence and Provenance Model
Description: Canonical evidence, derivation lineage, and export-disclosure provenance rules for Zeus Project Intelligence.
Last Updated: 2026-07-22
---

# ADR-011: Evidence and Provenance Model

**Status:** Accepted for ZPI-01 documentation baseline

## Context

Zeus Project Intelligence needs precise provenance to remain auditable, deterministic, and safe.
Existing Zeus documentation already distinguishes evidence, summaries, and generated artifacts, but
ZPI introduces longer-lived project knowledge, retrieval results, and context packages.

Using one vague concept of provenance would mix three different concerns:

- where source evidence came from
- how derived facts were produced
- what can safely leave the local trust zone

## Decision

ZPI uses three distinct provenance classes.

### 1. Source evidence provenance

Source evidence provenance identifies the trusted origin of preserved facts:

- project identity
- snapshot identity
- trusted root identity
- source-unit identity
- canonical path or member identity under the trusted root
- content hash and source span references

This provenance supports audit, reproducibility, and stale detection.

### 2. Derivation lineage provenance

Derivation lineage records how a fact was produced:

- analyzer identity and analyzer version
- derivation class such as `VERIFIED`, `INFERRED`, `UNRESOLVED`, `STALE`, or `INVALIDATED`
- dependency edges or source-evidence references used to derive the fact
- snapshot-local ordering or publication metadata needed for deterministic replay

Derived retrieval ranks, heuristics, and context assembly outputs are not source evidence. They must
carry lineage, but they must not mint new canonical evidence identities.

### 3. Export-disclosure provenance

Export-disclosure provenance records what a shareable or external-facing artifact omits, redacts, or
normalizes:

- redaction or omission reason codes
- whether a package is local-only or safe-sharing eligible
- non-claims such as `sourceOfTruth: false` for summaries, ranks, and context packages
- disclosure-safe placeholders for local paths or sensitive roots when applicable

### Canonical evidence rules

- Canonical evidence is always anchored to source evidence provenance.
- Derived facts without current evidence references cannot be promoted to `VERIFIED`.
- Retrieval hits, ranked result lists, and context packages are derived views and must remain
  explicitly non-canonical.
- Community and Commercial modules must use the same provenance vocabulary and schema families.
- Proprietary modules may add private artifacts, but they must not redefine Community provenance
  meanings.

## Consequences

- Later implementation packages can separate auditability from privacy and export concerns.
- Security and testing work can target provenance spoofing, stale serving, and export leakage as
  distinct failure modes.
- Community contract tests can enforce that derived retrieval or context layers never masquerade as
  source evidence.

## Alternatives considered

- **Single generic provenance object everywhere.** Rejected because audit, derivation, and export
  disclosure have different threat models.
- **Commercial-only provenance extensions for advanced workflows.** Rejected because core project
  knowledge must remain portable and verifiable without proprietary readers.
- **Treat retrieval results as evidence.** Rejected because ranks and snippets are derived aids, not
  authoritative facts.
