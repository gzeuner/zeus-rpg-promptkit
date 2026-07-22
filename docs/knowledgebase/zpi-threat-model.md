---
Title: ZPI Threat Model
Description: Documentation baseline threat model for Zeus Project Intelligence before runtime implementation.
Last Updated: 2026-07-22
---

# ZPI Threat Model

This document records the security baseline for ZPI-01. It is a documentation artifact, not a
runtime security claim.

## Scope

In scope:

- Community project-intelligence contracts and default backend boundaries
- Commercial extension boundaries that must not bleed into Community
- local trusted roots, preserved evidence, published snapshots, retrieval, and context packages
- thin CLI/API/MCP-neutral capability exposure

Out of scope:

- live IBM i runtime operations
- Package 09 reopen or new S4 execution paths
- production entitlement infrastructure details

## Assets

Protected assets:

- trusted local source trees and source-unit identities
- preserved evidence blobs and source spans
- published project snapshots and current-pointer state
- retrieval indexes and query results
- bounded context packages and omission manifests
- local diagnostics and audit artifacts

## Trust boundaries

| Boundary | Notes |
| -------- | ----- |
| Trusted local roots | only explicitly authorized source roots may be inventoried |
| Local project-intelligence store | sensitive local state; not safe-sharing by default |
| Thin CLI/API/MCP projection | read-mostly projection of approved capability surfaces only |
| Commercial extension boundary | entitlement-gated, separately distributed, never required for Community-owned readers |
| External sharing or model egress | deny by default unless a future policy explicitly allows it |

## Primary threats

### Path and filesystem escape

Threats:

- path traversal through source units, project IDs, or export paths
- symlink or junction escape outside trusted roots
- partial writes into attacker-controlled or world-readable paths

Required mitigations:

- canonical path validation before open or write
- trusted-root containment checks
- project ID and run ID character restrictions
- symlink and junction escape rejection
- create-or-rollback semantics for staged writes

### Resource exhaustion and oversized input

Threats:

- oversized projects exhausting memory, disk, or CPU
- dense graphs or retrieval expansions causing unbounded work
- repeated partial publishes consuming local storage

Required mitigations:

- numeric limits for file counts, bytes, graph expansion, and token budgets
- explicit reject-or-omit policy with reason codes
- single-writer publication model
- no silent partial current snapshot

### Provenance spoofing and stale serving

Threats:

- forged hashes, snapshot IDs, or `VERIFIED` facts
- current pointer referencing mixed or stale generations
- retrieval results presented as canonical evidence

Required mitigations:

- explicit source evidence, derivation lineage, and export-disclosure provenance classes
- published snapshots immutable after publish
- closed stale or invalidated reason codes
- retrieval and context packages marked non-canonical

### Leakage and unsafe export

Threats:

- absolute host paths in diagnostics or manifests
- credential-like files or source snippets leaking through search, MCP, or exports
- omission manifests leaking sensitive identifiers even when content is excluded

Required mitigations:

- redaction and safe-sharing rules distinct from token budgets
- deny-by-default export or egress behavior
- closed reason codes for forbidden source classes and disclosure denial
- explicit non-claims on derived packages and rankings

### Entitlement bleed and open-core boundary erosion

Threats:

- Community adapters that only function when Commercial is present
- paid capability discovery leaking as always-available in Community
- proprietary formats becoming required to read Community-owned project knowledge

Required mitigations:

- Community complete offline baseline
- entitlement enforcement only in Commercial modules
- Community-owned readers and migrations remain Community-owned
- capability discovery reflects actual registered state only

## Mandatory negative-test themes

The later runtime packages must include negative tests for at least:

- path traversal and project-ID escape
- symlink or junction escape
- oversized project refusal without partial publish
- provenance mismatch and stale current-pointer refusal
- snippet or path leakage through diagnostics, search, MCP, or exports
- Community-only operation with Commercial capability absence or entitlement denial
- context-package disclosure denial even when token budget would allow more content

## Owner decisions still required

- exact numeric default limits for storage, graph expansion, and token budgets
- exact community default destination policy for future external context egress
- exact closed reason-code vocabulary for all fail-closed states
