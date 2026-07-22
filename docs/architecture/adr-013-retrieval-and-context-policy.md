---
Title: ADR-013 Retrieval and Context Policy
Description: Deterministic Community retrieval and context-package policy with optional Commercial extensions.
Last Updated: 2026-07-22
---

# ADR-013: Retrieval and Context Policy

**Status:** Accepted for ZPI-01 documentation baseline

## Context

Zeus already prepares evidence and AI-consumable artifacts, but ZPI introduces persistent retrieval
and context assembly over project knowledge.

Without a default policy, Commercial modules could become the only useful context path. Without a
clear boundary, retrieval or context packages could also drift into unsafe snippet export, hidden
policy changes, or Package 09-style scope creep.

## Decision

### Community default policy

Community owns a complete default retrieval and context-assembly policy that is:

- local-only and offline by default
- bounded by explicit result and token limits
- deterministic for a pinned snapshot, query, and engine version
- evidence-first, with explicit omission reporting
- compatible with thin CLI, API, and MCP-neutral capability contracts

The Community default policy must be able to:

- retrieve bounded lexical results from published Community snapshots
- apply documented metadata and snapshot-safety filters
- assemble bounded context packages with explicit evidence references
- emit non-claims for summaries, rankings, and omitted material

### Commercial extensions

Commercial modules may register advanced retrieval or context policies only through public
Community contracts. They may improve ranking, graph expansion, incremental orchestration, or
resource governance, but they must not:

- redefine Community provenance classes
- weaken safety levels or trust-zone declarations
- change thin adapter discovery semantics without a contract revision
- make Community-owned artifacts unreadable without proprietary code
- reopen Package 09 or add live IBM i execution behavior

### Context-package rules

Every context package must:

- identify the project and published snapshot it was built from
- record the retrieval policy or assembler identity and version
- include evidence references for any source-derived claim intended for change or impact work
- include omission reasons when limits exclude material
- declare itself non-canonical and non-authoritative relative to preserved source evidence

A token budget constrains size, not sensitivity. Export or egress controls remain separate safety
concerns and must fail closed when the destination policy does not permit disclosure.

## Consequences

- Community remains able to build useful local context packages without paid policy modules.
- Commercial modules gain a clear extension surface that does not fork CLI/MCP adapter behavior.
- Later implementation packages can test deterministic retrieval and omission behavior against one
  documented baseline.

## Alternatives considered

- **Commercial-only context assembly.** Rejected because Community would cease to be a complete
  local evidence platform.
- **Treat context packages as canonical evidence.** Rejected because assembly output is a derived aid.
- **Use retrieval or context policy to reopen Package 09 behaviors.** Rejected because ZPI-01 is
  documentation-only and Package 09 remains closed.
