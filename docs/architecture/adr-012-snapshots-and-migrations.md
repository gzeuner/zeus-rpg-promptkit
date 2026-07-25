---
Title: ADR-012 Snapshots and Migrations
Description: Immutable publication, current-pointer semantics, and Community-owned migration rules for Zeus Project Intelligence.
Last Updated: 2026-07-25
---

# ADR-012: Snapshots and Migrations

**Status:** Accepted; snapshot / incremental engine delivered (ZPI-06)

## Context

Zeus already uses manifests, reproducible artifacts, and versioned contracts. ZPI adds longer-lived
project state that must survive rebuilds, reopen safely, and reject torn or stale generations.

The term `snapshot` is already overloaded across Zeus. ZPI needs a tight glossary and publication
model so persistence code and commercial orchestration share one state machine.

## Decision

### Snapshot glossary

ZPI uses these terms:

- **Project**: stable identity for one bounded trusted-root knowledge space
- **Source inventory**: the canonical list of source units and hashes for one input view
- **Analyzer run**: one deterministic derivation pass over a source inventory
- **Published snapshot**: one immutable published knowledge generation with stable identifiers and
  bound backend schema versions
- **Current pointer**: a single pointer naming the published snapshot that unpinned reads may serve

### Publication rules

- Published snapshots are immutable.
- Unpinned read operations may serve only the current published snapshot.
- Publish is atomic across SQLite metadata, content-addressed evidence, Lucene index generation, and
  current-pointer update.
- Readers must never observe a mixed-generation current state.
- Failed publish leaves the previous current snapshot intact or yields a fail-closed unavailable
  state. It must not advance the current pointer partially.

### Migration rules

Community owns migration rules for Community-owned project-intelligence formats and stores.
Commercial modules may add private artifacts or additive metadata, but they must not make Community
stores unreadable without proprietary code.

Migration requirements:

- store schema version, search schema version, and artifact schema versions are explicit and
  independently versioned
- unknown future required schema versions fail closed
- migrations are auditable and deterministic
- migration state must not be mistaken for a published current snapshot
- rollback behavior must be explicit: either revert to the last good published snapshot or refuse
  current reads

### Stale and invalidated data

If source deletion, rename, corruption, or migration mismatch means a published snapshot can no
longer be treated as current, ZPI must surface that state explicitly through closed reason codes and
lineage classes such as `STALE` or `INVALIDATED`.

### Portable snapshot packaging

A **portable snapshot package** (Track C) is a redacted offline export of a **published** snapshot
for transfer or archive. It is not a second current pointer, not a mutable workspace, and not
source of truth. Import/open validates schema and integrity and must fail closed on path leakage.

## Delivery

| Concern                           | Community location                                 |
| --------------------------------- | -------------------------------------------------- |
| Full rebuild / incremental update | `src/projectIntelligence/engine/snapshotEngine.js` |
| Diff / invalidation planning      | `engine/diffPlanner.js`, `engine/invalidation.js`  |
| Store migrations                  | `store/migrations.js`                              |
| Portable export                   | `export/portableSnapshotPackage.js`                |

## Consequences

- Deterministic reopen, rebuild, and validation behavior does not hide torn state.
- Canonical published state stays separate from transient build state.
- Commercial incremental refresh must converge on the same published-snapshot model rather than
  inventing a parallel state machine.

## Alternatives considered

- **Mutable current snapshot updated in place.** Rejected because it increases corruption and stale
  serving risk.
- **Commercial-only migration path.** Rejected because Community-owned stores and readers must remain
  self-sufficient.
- **Best-effort reads from mixed generations.** Rejected because stale or partial data must fail
  closed.
