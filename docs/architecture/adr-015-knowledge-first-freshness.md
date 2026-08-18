---
Title: ADR-015 Community Knowledge First and Snapshot Freshness
Description: Neutral first entry point for source-backed legacy knowledge without a graph database
Status: Accepted
Last Updated: 2026-08-18
---

# ADR-015: Community Knowledge First and Snapshot Freshness

## Decision

The public first point to check for known legacy relationships is the
`zeus.community.knowledge-first` service, exposed through
`project-knowledge check`, `project-knowledge locate`, `project-knowledge lookup`, and
the matching MCP tools.
It reuses the existing SQLite KnowledgeStore, content-addressed store, search index,
symbols, relationships, and evidence model. No graph database or parallel knowledge
store is introduced.

The immutable published source-backed snapshot is the authoritative, inspectable
knowledge checkpoint. Retrieval and context packages are derived navigation aids and
must never claim absolute truth. A lookup is servable only when a live inventory can
be compared with the published snapshot and the result is `fresh`. `stale` and
`unknown` are returned explicitly and fail closed for lookup. `sync` is always an
explicit local write and uses the existing full-build or incremental-update path.

Every public result carries `projectId`, `snapshotId` when available,
`sourceInventoryHash`, freshness status, trusted-root IDs, relative source identity,
content hashes, evidence/provenance, and relationships. Absolute host paths and
internal store handles are never part of the result contract.
For the default MCP surface, `knowledgeRoot` and all `trustedRoots` must resolve
inside the MCP server workspace. CLI and API callers may deliberately use other
absolute roots because those invocations are outside the automatic MCP allowlist.

## AI workflow

1. Call `zeus.project-knowledge.check` to establish the project, snapshot, and
   freshness status.
2. If the status is `stale`, call the explicit `zeus.project-knowledge.sync` only
   after the operator authorizes local indexing, then check again.
3. If the status is `unknown`, do not treat existing retrieval as current; provide or
   repair trusted roots and check again.
4. Call `zeus.project-knowledge.lookup` only after `fresh`. Start with the returned
   location and evidence hash, then follow the returned relationships and verify the
   source-backed evidence before making a claim.
5. Use `zeus.project-knowledge.locate` when the exact working place is known or can be
   narrowed by system, library, source file, member, or relative path. Treat `selected`
   as the working location only when `found` is true and `ambiguous` is false. An
   ambiguous result is a control signal to add selectors; it never chooses a source
   implicitly.

The stable minimum location identity is `trustedRootId + relativePath + contentHash`;
inventory freshness also includes `provenanceHash` and `importObservationHash` so a
provenance-only change cannot disappear from the published snapshot.
The `fresh` state only proves equality with the currently readable local trusted
roots. It does not prove that the remote IBM i source has not changed. Remote
freshness remains `not-checked` until a fetch or remote metadata comparison has
completed successfully.

Fetch manifests are read locally as an optional, per-trusted-root provenance source. The
manifest itself is never indexed or copied into the public knowledge store. Each source unit
may carry only a sanitized origin (`systemAlias`, `sourceLib`, `sourceFile`, `member`,
`memberPath`, `fetchedAt`, and optional `sourceType`) plus integrity status.
The sanitized origin is attached to the same source-unit location, provided no manifest, host,
credential, command, remote path, or absolute local path is emitted. Manifest `validation.sha256`
is compared first with the separately computed raw
bytes hash. A match against only the canonical text hash is reported as unknown because raw
versus canonical bytes are ambiguous; it is never claimed as remote freshness.

Inventory identity includes `provenanceHash` and `importObservationHash` in addition to the
canonical `contentHash`. A provenance-only change publishes a new snapshot and preserves
derived facts; it does not trigger code re-analysis. Local snapshot freshness remains the only
lookup-serving gate. Remote freshness remains `unknown` with reason `remote-not-checked`.

The locator is read-only and fresh-only. It resolves against published source units and
returns a redacted canonical location containing both the local relative identity and,
when present, the sanitized IBM i origin (`systemAlias`, `sourceLib`, `sourceFile`,
`member`, and `memberPath`). It does not fetch source or metadata and does not alter the
current working context. A later fetch or context-setting operation must consume the
selected locator explicitly.

## Consequences

- Community-only clients have one predictable, entitlement-free first entry point.
- Freshness is deterministic because it uses the existing inventory diff planner.
- A stale snapshot remains available for explicit inspection but cannot silently serve
  current knowledge.
- Snapshots created before import-observation fingerprints were introduced report `stale`
  once and require an explicit incremental `sync`; source facts are reused when their
  canonical content hash is unchanged.
- IBM i origin enrichment remains an additive provenance concern and does not create a
  second storage architecture.
