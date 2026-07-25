---
Title: ZPI Closure Status
Description: Final Zeus Project Intelligence delivery status, non-claims, pins, and gate evidence after ZPI-12.
Last Updated: 2026-07-25
---

# Zeus Project Intelligence — Closure Status

This document is the public Community closure status for the ZPI program (ZPI-01 through ZPI-12).
It records delivered surfaces, explicit non-claims, and verification posture. It is **not** a
product SLA, production certification, or live IBM i validation claim.

**Shipped in public prerelease:** Community package **0.2.0-beta.3**
([`v0.2.0-beta.3`](https://github.com/gzeuner/zeus-rpg-promptkit/releases/tag/v0.2.0-beta.3),
source `f1b6f29b73e59089c2873146f65f277663e38a4b`).

## Program map

| Package | Repo       | Delivered surface                                                                |
| ------- | ---------- | -------------------------------------------------------------------------------- |
| ZPI-01  | Community  | Docs / ADRs / ownership split / threat model / license inventory / test strategy |
| ZPI-02  | Community  | Contracts, reason codes, validators, fixtures, contract test kit                 |
| ZPI-03  | Community  | KnowledgeStore SPI + SQLite provider, locks, migrations                          |
| ZPI-04  | Community  | Content-addressed evidence store + trusted roots                                 |
| ZPI-05  | Community  | Search SPI + pure-JS lexical provider (`lucene/` layout)                         |
| ZPI-06  | Community  | Snapshot / incremental engine, atomic publish                                    |
| ZPI-07  | Community  | RPG/IBM i analyzer baseline                                                      |
| ZPI-08  | Community  | Hybrid retrieval + context package assembly                                      |
| ZPI-09  | Commercial | Entitled module registration, resource policy, non-claims                        |
| ZPI-10  | Commercial | Entitled project operations (create/index/query/impact/context/inspect/verify)   |
| ZPI-11  | Both       | Community thin CLI/MCP adapters; commercial cli/mcp availability + pin           |
| ZPI-12  | Both       | Hardening, benchmarks (evidence), docs, SBOM/release gates, final closure        |

## Community public surfaces

- API: `createZeus().projectIntelligence` and `zeus-rpg-promptkit/project-intelligence-contracts`
- CLI: `zeus project-knowledge` (thin adapter; commercial ops only when registered)
- MCP: `zeus.project-knowledge.*` tools + `zeus://metadata/project-intelligence.json`
- Engines remain usable without commercial modules (Community-owned readers/stores)

## Commercial pin discipline

Commercial pins an exact Community SHA. After each Community merge that commercial depends on,
commercial must re-pin **all** hardcoded pin locations (not only `package.json`), re-run its full
test suite, and keep `npm run audit:prod` green before claiming compatibility.

Current public beta.3 baseline pin used by the commercial package at release time:
`f1b6f29b73e59089c2873146f65f277663e38a4b`.

## Non-claims (closed)

- Not source of truth — preserved source evidence remains authoritative
- Not a compile, deploy, or live IBM i execution product
- Package 09 remains closed (no live IBM i compile/execute flows introduced by ZPI)
- No implicit workspace harvest without explicit trusted roots
- Benchmark numbers are **evidence**, not production guarantees
- Community adapters contain **no paid implementation**
- Commercial entitlement is module-managed offline; core never enforces licenses

## Security posture (ZPI-12)

Verified by automated tests and repository gates:

- trusted-root containment; no implicit scan
- path redaction on adapter/MCP fail and success paths
- single-writer locks / parallel writer refusal
- integrity checks on store
- token budget and retrieval limit bounds
- commercial absent/present discovery without paid code leakage
- offline-first default; no network requirement for Community PI engines

See also: [zpi-threat-model.md](./zpi-threat-model.md), [zpi-license-inventory.md](./zpi-license-inventory.md).

## Benchmarks (evidence only)

`tests/project-intelligence-benchmark.test.js` measures on a synthetic local corpus:

- full rebuild duration
- incremental update duration
- query / context assembly duration
- approximate store / search / content footprint
- full-vs-incremental equality of project views

These metrics appear in test logs for closure evidence. They are **not** SLAs.

## Gate checklist

Community (representative):

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
npm run audit:prod   # if script present; else npm audit --omit=dev
```

Commercial:

```text
npm run test:discovery
npm test
npm run audit:prod
npm run package:smoke
```

## Remaining optional work (out of ZPI-12)

- larger multi-repo corpora and CI-hosted perf dashboards
- optional vector embeddings (disabled by default per ADR)
- portable snapshot export packaging beyond current contracts
- host-app auto-registration of commercial modules into CLI process (explicit load remains host-owned)

## Final state statement

ZPI Community baseline (contracts through engines, retrieval, thin CLI/MCP adapters) and Commercial
registration/ops are **delivery-complete** for the ZPI program scope. Further product work is
optional hardening, packaging, or new product packages outside ZPI-01..12.
