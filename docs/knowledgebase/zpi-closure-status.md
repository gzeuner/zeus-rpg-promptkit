---
Title: ZPI Closure Status
Description: Final Zeus Project Intelligence delivery status, non-claims, pins, and gate evidence after ZPI-12.
Last Updated: 2026-08-17
---

# Zeus Project Intelligence — Closure Status

This document records the delivered Project Intelligence surface in the unified public
Apache-2.0 package. It records delivered surfaces, explicit non-claims, and verification posture.
It is **not** a product SLA, production certification, or live IBM i validation claim.

**Public package baseline:** **0.2.0**. The consolidation changes are maintained on the
public repository branch and become part of the unified product after merge.
([`v0.2.0-beta.5`](https://github.com/gzeuner/zeus-rpg-promptkit/releases/tag/v0.2.0-beta.5)).
ZPI Community baseline first shipped in
[`v0.2.0-beta.3`](https://github.com/gzeuner/zeus-rpg-promptkit/releases/tag/v0.2.0-beta.3)
(source `487cca7b06d287b7d5cb53024ca54747500dd584`).

## Program map

| Package | Repo           | Delivered surface                                                              |
| ------- | -------------- | ------------------------------------------------------------------------------ |
| ZPI-01  | Public package | Docs / ADRs / threat model / license inventory / test strategy                 |
| ZPI-02  | Public package | Contracts, reason codes, validators, fixtures, contract test kit               |
| ZPI-03  | Public package | KnowledgeStore SPI + SQLite provider, locks, migrations                        |
| ZPI-04  | Public package | Content-addressed evidence store + trusted roots                               |
| ZPI-05  | Public package | Search SPI + pure-JS lexical provider (`lucene/` layout)                       |
| ZPI-06  | Public package | Snapshot / incremental engine, atomic publish                                  |
| ZPI-07  | Public package | RPG/IBM i analyzer baseline                                                    |
| ZPI-08  | Public package | Hybrid retrieval + context package assembly                                    |
| ZPI-09  | Public package | Entitled module registration, resource policy, non-claims                      |
| ZPI-10  | Public package | Entitled project operations (create/index/query/impact/context/inspect/verify) |
| ZPI-11  | Public package | CLI/MCP adapters with explicit built-in and external registration              |
| ZPI-12  | Public package | Hardening, benchmarks, docs, SBOM/release gates, final closure                 |

## Public surfaces

- API: `createZeus().projectIntelligence` and `zeus-rpg-promptkit/project-intelligence-contracts`
- CLI: `zeus project-knowledge` (thin adapter; entitled operations require explicit registration)
- MCP: `zeus.project-knowledge.*` tools + `zeus://metadata/project-intelligence.json`
- Engines remain usable offline without license material or external extensions
- Built-in modules are selected explicitly through `--built-in-modules` or `ZEUS_BUILT_IN_MODULES`

## External extension compatibility

The former commercial loader remains only as an explicit compatibility hook for separately supplied
extensions. It does not participate in built-in registration, automatic discovery, or the default
public product path. External extensions must be tested against the public package version they use.

## Non-claims (closed)

- Not source of truth — preserved source evidence remains authoritative
- Not a compile, deploy, or live IBM i execution product
- Package 09 remains closed (no live IBM i compile/execute flows introduced by ZPI)
- No implicit workspace harvest without explicit trusted roots
- Benchmark numbers are **evidence**, not production guarantees
- adapters expose only registered capabilities and fail closed when unavailable
- entitlement is a runtime product policy within the unified Apache-2.0 package

## Security posture (ZPI-12)

Verified by automated tests and repository gates:

- trusted-root containment; no implicit scan
- path redaction on adapter/MCP fail and success paths
- single-writer locks / parallel writer refusal
- integrity checks on store
- token budget and retrieval limit bounds
- absent/present discovery without capability or private-code leakage
- offline-first default; no network requirement for Project Intelligence engines

See also: [zpi-threat-model.md](./zpi-threat-model.md), [zpi-license-inventory.md](./zpi-license-inventory.md).

## Benchmarks (evidence only)

`tests/project-intelligence-benchmark.test.js` measures on a synthetic local corpus:

- full rebuild duration
- incremental update duration
- query / context assembly duration
- estimated full-source versus context-package token usage and bounded savings on the synthetic corpus
- approximate store / search / content footprint
- full-vs-incremental equality of project views

These metrics appear in test logs for closure evidence. They are **not** SLAs.

## Gate checklist

Public package:

```text
npm run format:check
npm run lint
npm run typecheck
npm run test:contract
npm run test:smoke
npm run test:unit
npm run test:benchmark
npm run check:public-knowledge-claims
npm run docs:check
npm run check:repo-portability
npm run test:release-integrity
npm run test:cli-help
npm run check:consolidated-hygiene
npm audit --omit=dev --audit-level=high
```

## Remaining optional work (out of ZPI-12)

- larger multi-repo corpora and CI-hosted perf dashboards (beyond Track C mini corpus)
- optional vector **ranking** engines (storage opt-in exists; lexical ranking remains the default)
- additional external extensions, which remain explicitly host-owned and are not auto-loaded

### Track C (optional depth) — shipped in the public package

| Item                               | Location                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| Portable snapshot export packaging | `src/projectIntelligence/export/` — `exportPortableSnapshotPackage`, `openPortableSnapshotPackage` |
| Offline corpora fixtures           | `src/projectIntelligence/corpora/` — `mini-multi-program-rpg`                                      |
| Embeddings default off             | `src/projectIntelligence/search/embeddingPolicy.js` — ranking never uses vectors by default        |

## Final state statement

The Project Intelligence baseline, integrated registration/operations, and CLI/MCP adapters are
**delivery-complete** for the ZPI program scope. Further product work is optional hardening,
packaging, or new product packages outside ZPI-01..12.
