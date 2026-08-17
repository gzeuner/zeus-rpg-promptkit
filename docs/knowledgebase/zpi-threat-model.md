---
Title: ZPI Threat Model
Description: Current security baseline for the integrated Zeus Project Intelligence surface.
Last Updated: 2026-08-17
---

# ZPI Threat Model

This document records the security baseline for the integrated Project Intelligence surface. It is
a design and test artifact, not a runtime security claim or product certification.

## Scope

In scope:

- public Project Intelligence contracts and local backend boundaries
- integrated built-in modules and explicit external extension boundaries
- local trusted roots, preserved evidence, published snapshots, retrieval, and context packages
- thin CLI/API/MCP-neutral capability exposure

Out of scope:

- live IBM i runtime operations
- Package 09 reopen or new S4 execution paths
- production entitlement infrastructure outside the package contract

## Assets

Protected assets:

- trusted local source trees and source-unit identities
- preserved evidence blobs and source spans
- published project snapshots and current-pointer state
- retrieval indexes and query results
- bounded context packages and omission manifests
- local diagnostics and audit artifacts

## Trust boundaries

| Boundary                         | Notes                                                                 |
| -------------------------------- | --------------------------------------------------------------------- |
| Trusted local roots              | only explicitly authorized source roots may be inventoried            |
| Local project-intelligence store | sensitive local state; not safe-sharing by default                    |
| Thin CLI/API/MCP projection      | registered capabilities only; unavailable operations fail closed      |
| Built-in module boundary         | explicit registration and runtime entitlement; no automatic discovery |
| External extension boundary      | operator-supplied in-process code is trusted code, not a sandbox      |
| External sharing or model egress | deny by default unless a future policy explicitly allows it           |

### CLI/MCP adapter surface (ZPI-11/12)

Threats:

- exposing paid handlers without entitlement
- absolute host-path leakage through adapter/MCP error payloads
- default MCP allowlist exposing write/index tools

Required mitigations (implemented):

- capability present/absent discovery without implicit module loading
- fail-closed `CAPABILITY_UNAVAILABLE` when unregistered
- path redaction helpers on integrated operation results
- MCP safe defaults limited to discover + status; write/index require explicit allow-tools

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

### Entitlement and registration bleed

Threats:

- adapters that only function when a capability is implicitly present
- protected capability discovery leaking as always-available
- proprietary formats becoming required to read public project knowledge

Required mitigations:

- complete offline public baseline
- entitlement enforcement at the runtime module policy boundary
- public readers and migrations remain usable without external extensions
- capability discovery reflects actual registered state only

## Mandatory negative-test themes

The later runtime packages must include negative tests for at least:

- path traversal and project-ID escape
- symlink or junction escape
- oversized project refusal without partial publish
- provenance mismatch and stale current-pointer refusal
- snippet or path leakage through diagnostics, search, MCP, or exports
- public-only operation with built-in capability absence or entitlement denial
- context-package disclosure denial even when token budget would allow more content

## Owner decisions still required

- exact numeric default limits for storage, graph expansion, and token budgets
- exact community default destination policy for future external context egress
- exact closed reason-code vocabulary for all fail-closed states
