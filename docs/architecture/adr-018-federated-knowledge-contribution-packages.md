---
Title: ADR-018 — Federated Knowledge Contribution Packages
Description: Versioned, deterministic and evidence-aware packages provide an offline exchange boundary between independent knowledge instances.
Status: Accepted
---

# ADR-018 — Federated Knowledge Contribution Packages

## Context

Independent knowledge instances need to exchange reviewed, structured
contributions without sharing a mutable database. Existing portable snapshot
exports are read-only and advisory, but they do not identify a contribution,
its derivation, its evidence, its review state or its exchange lifecycle.

## Decision

A contribution package consists of exactly canonical `manifest.json` and
`payload.json` files. The manifest records contribution identity, origin,
base snapshot, contract versions, derivation class, evidence references,
provenance, privacy and quality reports, lifecycle status and integrity hashes.

Canonical serialization recursively sorts object keys, preserves array order
and ends with one LF. Package creation never discovers workspace files. Payload,
manifest and package hashes are independent of object insertion order.

The package boundary rejects secrets, credentials, raw-source fields, absolute
or traversal paths, disclosure URLs, prompt/model-output fields and authority
claims that would make derived content a source of truth. Derived packages
carry `advisory: true` and `sourceOfTruth: false`.

Validation is a side-effect-free gate with stable `FKX.*` reason codes. It
checks integrity, schema, contract versions, base snapshot, freshness,
provenance, evidence, privacy, disclosure, trust zone, capability, idempotency
and lifecycle. Validation does not stage, accept or publish a contribution.

Local staging is content-addressed, records status history and is protected by
a writer scope. Reconciliation emits deterministic findings and manual
accept/reject/supersede proposals. Neither operation publishes a snapshot.

An offline exchange is a separate, receipt-bound directory containing the
validated contribution package and an acceptance receipt. The receipt binds
the package hash, base snapshot, target snapshot, review decision and hashed
review identity. Exchange writes are atomic and idempotent for the same
receipt. Opening an exchange rechecks package and receipt integrity. Exchange
acceptance never advances a snapshot pointer and always reports
`publication: false`.

Receipt-bound publication is a separate local operation. Its coordinator
requires a complete base and target fingerprint, an explicitly local and
atomic snapshot writer, a durable receipt-keyed publication record and a
history entry with rollback evidence. It checks replay before mutation,
rechecks the current pointer, verifies the resulting target pointer and fails
closed when the writer reports an incomplete or mixed generation. The
coordinator does not choose a provider, perform transport, or infer how a
payload becomes domain-specific snapshot entities; that materialization is an
explicit responsibility of the injected snapshot writer.

The local provider-contribution bridge accepts only an explicitly registered
model descriptor, an explicit opt-in, an allowed egress policy decision and a
contract-valid response. It records provider/model/version/digest provenance
and a request fingerprint, while keeping request and response raw data outside
the contribution package. The resulting package is always `proposed`,
`advisory: true` and `sourceOfTruth: false`; requested `VERIFIED` derivation is
made visible as an `INFERRED` result. The bridge does not discover, select or
invoke providers and cannot publish a snapshot.

A separate local verification receipt records an explicit Git identity,
worktree state, package versions, gate results, test summaries, fixture hashes,
warnings and deferred decisions. Its canonical hash covers only bounded,
already-sanitized metadata; the receipt rejects failed gates, unsafe fields,
remote actions, mutation flags and publication claims. Receipt creation does
not execute commands or read source content.

## Consequences

- Offline exchange does not require a shared mutable knowledge store.
- Equivalent structured inputs receive stable package identities.
- Privacy and disclosure are enforced at the data boundary and during validation.
- Staging, exchange acceptance and publication remain separate lifecycles.
- Offline exchange and snapshot publication remain separate operations.
- Publication requires an explicit local materialization adapter and cannot
  be enabled by a status transition alone.
- Provider output remains derived and advisory.
- Conflict handling remains explicit and reviewable.

## Deferred work

Domain-specific payload materialization adapters and network transports remain
deferred. Any adapter must use the existing snapshot, review, trust-zone and
writer boundaries. Provider-derived contribution creation is available only as
the local, non-invoking bridge described above; provider invocation and
automatic acceptance remain out of scope.
