---
Title: ZPI License Inventory and Dependency Governance
Description: ZPI-01 licensing baseline, planned engine compatibility notes, and unresolved dependency decisions.
Last Updated: 2026-07-22
---

# ZPI License Inventory and Dependency Governance

This document records the ZPI-01 licensing baseline. It is not legal advice.

## Repository baseline

| Repository                                 | Current status                       |
| ------------------------------------------ | ------------------------------------ |
| Community `zeus-rpg-promptkit`             | Apache-2.0                           |
| Commercial `zeus-rpg-promptkit-commercial` | `UNLICENSED` proprietary placeholder |

Commercial depends on the public Community repository pinned to commit
`3a6586dca648e41dbd74ef48e0848e9830cfc113`.

## Planned default engines

| Planned engine | Expected role           | Licensing baseline                                       | ZPI-01 note                                                                                |
| -------------- | ----------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| SQLite         | local metadata store    | upstream SQLite is commonly distributed as public domain | exact runtime binding still undecided; binding license must be reviewed separately         |
| Apache Lucene  | lexical retrieval index | Apache-2.0                                               | exact runtime binding still undecided; transitive dependencies must be reviewed separately |

## Governance rules for later implementation packages

- Community defaults must remain redistributable under the Community Apache-2.0 release model.
- Commercial code may depend on Community public exports, but Community must not depend on
  proprietary code or entitlements.
- Exact dependency selection for SQLite and Lucene bindings is a governance event and must document:
  runtime vs dev/test role, native vs pure-JS footprint, transitive licenses, SBOM impact, and
  offline-install behavior.
- Avoid SSPL, source-available, field-of-use, or network-restricted licenses for Community default
  backends.
- Optional future vector or embedding dependencies require a separate review and must remain optional
  relative to the Community lexical baseline.

## Attribution and release-process notes

ZPI implementation packages must preserve or establish:

- Community Apache-2.0 `LICENSE` continuity
- any required third-party attribution or `NOTICE` material for selected bindings
- SBOM coverage for store and search dependencies in Community releases and combined commercial
  distributions
- explicit review of native binary or toolchain implications if a chosen binding is not pure-JS

## Resolved baseline statements

- The ownership split is license-compatible if Community owns the default engines and Commercial
  remains separately distributed.
- Commercial policy modules do not relicense the Community pin.
- Raw user project data portability is separate from dependency attribution obligations.

## Resolved in ZPI-03 (SQLite binding)

| Decision            | Choice                                                           | Notes                                                                             |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| SQLite runtime      | Node.js built-in `node:sqlite` (`DatabaseSync`)                  | No extra npm dependency; SQLite public-domain engine via Node                     |
| Native npm binding  | Not selected                                                     | Avoids better-sqlite3 native compile / prebuild SBOM surface                      |
| Pure-JS sql.js      | Not selected for default                                         | Reserved as future fallback if engines must stay on Node 20 without `node:sqlite` |
| Runtime requirement | Store operations require a Node build that exposes `node:sqlite` | Probe via `probeNodeSqlite()`; fail closed with `ZPI.STORE_UNAVAILABLE`           |

## Resolved in ZPI-05 (search / lexical engine)

| Decision                   | Choice                                                  | Notes                                                                                        |
| -------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Search SPI                 | Community-owned under `src/projectIntelligence/search/` | Full-text, filters, ranking, rebuild, vector-ready schema                                    |
| Default Community engine   | Pure-JS inverted index `zeus.community-lexical`         | No extra npm dependency; deterministic ranking; index under `lucene/` layout                 |
| Apache Lucene Java binding | Deferred                                                | Architectural target remains Lucene (ADR-010); Node-safe binding is a later governance event |
| Vector search              | Schema-ready only                                       | Optional `vector` field on documents; not used for ranking in v1                             |

## Unresolved decisions

- exact Apache Lucene runtime package, bridge, or hosting strategy for a future swap-in
- whether a Lucene binding adds native compilation, JARs, or bundled binaries
- what Community `NOTICE` attribution will be required once a Lucene package is chosen
- whether future optional embedding or vector packages introduce new redistribution or model-license
  constraints
