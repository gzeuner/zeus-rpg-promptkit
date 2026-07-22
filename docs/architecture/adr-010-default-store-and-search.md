---
Title: ADR-010 Default Store and Search Architecture
Description: SQLite metadata, content-addressed evidence storage, and Lucene lexical retrieval as the Community default project-intelligence backends.
Last Updated: 2026-07-22
---

# ADR-010: Default Store and Search Architecture

**Status:** Accepted for ZPI-01 documentation baseline

## Context

Zeus Project Intelligence needs a deterministic local persistence and retrieval baseline that works
without network access, external services, or proprietary dependencies.

The default backend must support:

- durable project and snapshot metadata
- content-addressed evidence storage
- deterministic lexical retrieval
- bounded local resource usage
- Windows-compatible local operation
- compatibility with Community artifact portability and Commercial extension points

## Decision

Community adopts this default backend architecture:

- SQLite for canonical project, snapshot, source-unit, symbol, relationship, and migration
  metadata
- content-addressed local files for preserved evidence payloads and large immutable source content
- Apache Lucene for lexical retrieval over published Community snapshots

This baseline is local-first and offline by default. No external database, search service,
embedding service, or mandatory daemon is required.

### Backend roles

| Backend                 | Role                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| SQLite                  | canonical derived metadata, indexes of record, lifecycle state, migrations, current pointer |
| Content-addressed files | immutable evidence blobs and preserved source payloads                                      |
| Lucene                  | lexical retrieval over published snapshot content and metadata                              |

### Determinism requirements

The Community default backends must document and preserve deterministic behavior:

- explicit canonical path normalization rules
- explicit analyzer identity and analyzer version for Lucene-backed retrieval
- stable document identifiers and deterministic tie-break ordering
- explicit query result bounds and omission reporting
- single-writer publish semantics for SQLite, Lucene, and content-store state
- reproducibility guidance for metadata that is intentionally non-canonical

Scores may be advisory, but ordered hit identifiers must be deterministic for a pinned engine
version, analyzer version, and snapshot.

### Fail-closed requirements

If any required backend is unavailable, corrupt, mismatched, or only partially published:

- project-intelligence read or write operations must fail closed with stable reason codes
- the system must not silently serve partial or mixed-generation data as current
- Community readers must prefer refusal or explicit degraded status over fabricated empty success

### Explicit exclusions for the default baseline

The Community default backend does not require:

- vector databases or external embedding services
- live IBM i access
- remote activation, telemetry, or entitlement checks
- commercial policy modules
- a second proprietary registry for retrieval or search behavior

Vector-ready schema fields may be added later only as optional extensions. Lexical retrieval remains
the mandatory Community baseline.

## Consequences

- Community implementation packages can target a clear local baseline before advanced policy work.
- Commercial modules can add orchestration or advanced ranking through public contracts without
  replacing the default storage and search foundations.
- Dependency selection for actual SQLite and Lucene bindings becomes a governance event that must
  preserve Apache-2.0 compatibility and offline operation.

## Alternatives considered

- **Remote database and hosted search.** Rejected because ZPI must remain local-first and offline by
  default.
- **Lucene-only storage.** Rejected because canonical metadata, migrations, and lifecycle state need
  a transactional metadata store separate from search indexes.
- **SQLite full-text only.** Rejected because ZPI needs a stronger lexical retrieval baseline and a
  clear path to bounded search-specific schema evolution.
- **Commercial-only default backends.** Rejected because Community must remain complete and useful.
