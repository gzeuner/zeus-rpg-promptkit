---
Title: ADR-017 — Evidence-backed Business Process Projection
Description: Process knowledge is a reviewable projection above the technical Project Intelligence graph.
Status: Accepted
---

# ADR-017 — Evidence-backed Business Process Projection

## Context

Legacy ERP behavior is distributed across programs, procedures, files, SQL,
interfaces, and unresolved dependencies. An AI needs a domain-oriented process
view, but a generated business description must not become an untraceable or
automatically authoritative interpretation of source code.

## Decision

Business-process knowledge is an additive projection over the existing ZPI
contracts. It reuses project and snapshot identity, provenance, source
evidence references, derivation classes, confidence, and freshness boundaries.
The projection contains candidate processes, versioned descriptions, steps,
claims, relationships, glossary entries, and a query-result contract.

Discovery is deterministic. Stable identifiers are derived from normalized
technical graph content; timestamps and random identifiers are not used for
candidate identity. Unresolved dependencies and missing direct source
locations produce explicit uncertainty or diagnostics.

Description generation is schema-constrained and evidence-limited. It may
summarize supplied technical facts, but it may not invent business goals,
roles, rules, interfaces, or steps. Candidate knowledge remains separate from
reviewed and published knowledge. Publishing requires an explicit approved
review with reviewer identity and timestamp, followed by an explicit
publication operation.

## Consequences

- Product Owners, architects, developers, and testers can consume different
  projections later without creating competing sources of truth.
- A future chat adapter can answer from the same process contracts and cite
  technical evidence, freshness, confidence, and unknowns.
- The current library vertical slice is intentionally read-only. CLI query and
  impact routes are a subsequent iteration.
- Process descriptions remain derived knowledge; source code and published
  snapshots remain the evidence authority.

## Rejected alternatives

- A free-form AI summary without contracts was rejected because it hides
  unsupported assumptions and prevents deterministic review.
- A second process database was rejected because it would duplicate freshness,
  provenance, and snapshot rules.
- Automatic publishing was rejected because domain interpretation requires an
  explicit human decision.
