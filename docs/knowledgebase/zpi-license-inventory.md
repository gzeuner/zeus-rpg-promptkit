---
Title: ZPI License Inventory and Dependency Governance
Description: ZPI-01 licensing baseline, planned engine compatibility notes, and unresolved dependency decisions.
Last Updated: 2026-07-22
---

# ZPI License Inventory and Dependency Governance

This document records the ZPI-01 licensing baseline. It is not legal advice.

## Repository baseline

| Repository | Current status |
| ---------- | -------------- |
| Community `zeus-rpg-promptkit` | Apache-2.0 |
| Commercial `zeus-rpg-promptkit-commercial` | `UNLICENSED` proprietary placeholder |

Commercial depends on the public Community repository pinned to commit
`3a6586dca648e41dbd74ef48e0848e9830cfc113`.

## Planned default engines

| Planned engine | Expected role | Licensing baseline | ZPI-01 note |
| -------------- | ------------- | ------------------ | ----------- |
| SQLite | local metadata store | upstream SQLite is commonly distributed as public domain | exact runtime binding still undecided; binding license must be reviewed separately |
| Apache Lucene | lexical retrieval index | Apache-2.0 | exact runtime binding still undecided; transitive dependencies must be reviewed separately |

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

## Unresolved decisions

- exact SQLite runtime package or binding
- exact Lucene runtime package, bridge, or hosting strategy
- whether any selected binding adds native compilation or bundled binaries
- what Community `NOTICE` or third-party attribution process will be used once concrete packages are
  chosen
- whether future optional embedding or vector packages introduce new redistribution or model-license
  constraints
