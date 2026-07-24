---
Title: Knowledgebase Reset
Description: Reset notice, ZPI architecture references, and safety rules for future knowledgebase work.
Last Updated: 2026-07-22
---

# Knowledgebase Reset

The previous source-derived persistent knowledge path was removed/reset.

Future knowledgebase work must follow:

- [project-neutral-knowledgebase-architecture.md](./project-neutral-knowledgebase-architecture.md)
- [zpi-threat-model.md](./zpi-threat-model.md)
- [zpi-license-inventory.md](./zpi-license-inventory.md)
- [zpi-test-strategy.md](./zpi-test-strategy.md)

Non-negotiable rules:

- raw evidence must not enter the final knowledge model
- final knowledge output must pass a fail-closed privacy gate
- only project-neutral generalized patterns may be persisted
- only synthetic fixtures are allowed in tests and docs
- MCP/API knowledge surfaces remain disabled until a final safe catalog exists

Current implementation status:

- `src/knowledge/` now contains a skeleton with `raw/`, `sanitized/`, `final/`, and `privacy/` boundaries
- no runtime extractor or persistence is implemented yet
- the privacy gate is fail-closed and rejects malformed or suspicious final-catalog candidates
- **ZPI-02 (contracts):** `src/projectIntelligence/` versioned project-knowledge contracts, closed
  reason codes, validators, fixtures, and a contract test kit
- **ZPI-03 (store):** `src/projectIntelligence/store/` KnowledgeStore SPI + SQLite metadata provider
  (`node:sqlite`), writer locks, migrations, integrity checks
- **ZPI-04 (content):** `src/projectIntelligence/content/` content-addressed object store (sha256),
  trusted-root path controls, text canonicalization, atomic write/dedupe; GC is design-only
- **ZPI-05 (search):** `src/projectIntelligence/search/` Search SPI + Community pure-JS lexical
  provider under the standard `lucene/` layout
- **ZPI-06 (snapshots):** `src/projectIntelligence/engine/` inventory, diff planner, invalidation,
  atomic publish + current pointer / incremental update
- **ZPI-07 (RPG analyzer):** `src/projectIntelligence/analyzers/` RPG/CL parser adapters over
  Community scanners, source spans, unresolved reference model, default engine analyzer
- **ZPI-08 (retrieval/context):** `src/projectIntelligence/retrieval/` hybrid lexical/graph
  retrieval, token budgets, source verification, context package assembly with omission reporting
- **ZPI-11 (CLI/MCP adapters):** `src/projectIntelligence/adapters/` thin Community CLI/MCP surface
  (`zeus project-knowledge`, `zeus.project-knowledge.*` tools, discovery resource). Operations execute
  only when commercial capabilities are registered; absent path fails closed with no paid code in Community
- **ZPI-12 (hardening/closure):** benchmarks (evidence), hardening tests, closure status document,
  repository gate evidence — see [zpi-closure-status.md](./zpi-closure-status.md)

Local risk handling:

- old extracted data must not be migrated
- `.local` audit/session-note files that preserve removed knowledge paths are local risk artifacts and should be purged unless proven synthetic
- raw exports outside `.zeus/knowledge` (for example old `output/pui-dddl/*`) must be treated as unsafe local evidence, not reusable knowledge
- DDDL is local raw interchange only and must not be promoted to final project-neutral knowledge

Internal knowledge-lab note:

- internal lab tooling may exist locally under `.local/internal-tools/knowledge-lab/`
- this lab is local-only and not a CLI/MCP/API product feature
- raw/intermediate lab outputs are sensitive and disposable
- lab outputs must not be treated as final project-neutral knowledge
- only privacy-passed final catalog objects may cross into runtime surfaces
