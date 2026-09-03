---
Title: Zeus RPG PromptKit Architecture Documentation
Description: Accepted architecture decisions, kernel definition, dependency rules, contracts, capability model, safety trust zones, open-core module boundaries, and delivered ZPI contracts.
Last Updated: 2026-08-17
---

# Architecture Documentation

This directory contains the authoritative architecture decisions for Zeus RPG PromptKit.

All subsequent implementation and agent guidance must be consistent with these decisions.

## Accepted Architecture Decision Records (ADRs)

| ADR                                                 | Title                                 | Status                                                         |
| --------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| [001](adr-001-product-kernel.md)                    | Product Kernel                        | Accepted                                                       |
| [002](adr-002-dependency-direction.md)              | Dependency Direction                  | Accepted                                                       |
| [003](adr-003-versioned-contracts.md)               | Versioned Contracts                   | Accepted                                                       |
| [004](adr-004-capability-registry.md)               | Capability Registry                   | Accepted                                                       |
| [005](adr-005-safety-trust-zones.md)                | Safety Trust Zones                    | Accepted                                                       |
| [006](adr-006-commercial-extension-architecture.md) | Commercial Extension Architecture     | Accepted; executable registrar shipped                         |
| [007](adr-007-provider-neutral-contracts.md)        | Provider-Neutral AI Contracts         | Accepted                                                       |
| [008](adr-008-generation-validation-foundation.md)  | Generation Validation Foundation      | Accepted                                                       |
| [009](adr-009-project-intelligence-ownership.md)    | Project Intelligence Ownership Split  | Accepted; Community baseline delivered (ZPI-02…12 + Track C)   |
| [010](adr-010-default-store-and-search.md)          | Default Store and Search Architecture | Accepted; Community backends delivered; embeddings default off |
| [011](adr-011-evidence-and-provenance.md)           | Evidence and Provenance Model         | Accepted; enforced in Community PI contracts + portable export |
| [012](adr-012-snapshots-and-migrations.md)          | Snapshots and Migrations              | Accepted; snapshot engine delivered                            |
| [013](adr-013-retrieval-and-context-policy.md)      | Retrieval and Context Policy          | Accepted; retrieval/context delivered                          |
| [014](adr-014-unified-capability-consolidation.md)  | Unified Capability Consolidation      | Accepted                                                       |
| [015](adr-015-knowledge-first-freshness.md)         | Knowledge-First Freshness             | Accepted                                                       |
| [016](adr-016-mcp-adapter-boundary.md)              | MCP Adapter Boundary                  | Accepted                                                       |
| [015](adr-015-optional-vscode-adapter-boundary.md)  | Optional VS Code Adapter Boundary     | Accepted                                                       |

## Related Reviews

- [Runtime Config Model Review](runtime-config-model-review.md) - details the layered profile and runtime configuration system (pre-dates formal ADRs).

## How to Use These Documents

- New features and refactors must cite relevant ADRs in PR descriptions.
- When adding commands, stages, or MCP tools, follow the capability registry strategy (ADR-004) and declare safety level (ADR-005).
- Data artifacts (manifests, knowledge projections, canonical model) follow versioning rules in ADR-003.
- Code organization must respect the dependency direction (ADR-002).
- The product kernel (ADR-001) defines the stable evidence and artifact production responsibilities.
- External modules and capabilities must follow the open-core ownership, explicit registration,
  compatibility, failure-isolation, and artifact-portability rules in ADR-006.
- Optional AI adapters must follow the versioned contracts, explicit provider identity,
  private-by-default transport policy, redaction, and evidence-separation rules in ADR-007.
- Structured generation candidates must follow the offline validation, path/scope safety,
  evidence-reference, and non-mutation rules in ADR-008. `review-ready` is never compile readiness.
- ZPI work must follow the ownership, default-backend, provenance, snapshot, and retrieval-policy
  rules captured in ADR-009 through ADR-013. Delivery status and non-claims:
  [`../knowledgebase/zpi-closure-status.md`](../knowledgebase/zpi-closure-status.md).
- Built-in and external modules must use the trusted in-process registrar and module descriptor
  contracts (ADR-006 executable subset; see `docs/modules/authoring-external-module-registration.md`).
  Runtime entitlement is a product policy, not a source-license boundary (ADR-014).
- The optional VS Code adapter must remain a thin, CLI-first editor boundary with explicit workspace roots and no
  implicit remote reads (ADR-015).

## Regenerating Supporting Artifacts

```bash
node cli/zeus.js docs:generate-catalog
```

The tool catalog (`../tool-catalog.md`) is the published surface of the capability model.

## Governance

ADRs 001–008 establish the product kernel, contracts, capability model, safety, external modules,
providers, and generation validation. ADRs 009–013 originally froze the ZPI documentation baseline
(package ZPI-01) and are now **accepted with delivered Community implementations** (ZPI-02…12) plus
optional Track C depth (portable export, corpora fixtures, embeddings default off). Delivery and
non-claims: [`../knowledgebase/zpi-closure-status.md`](../knowledgebase/zpi-closure-status.md).

They remain grounded in the module structure and contracts on `main` (including
`src/projectIntelligence/`, `cli/zeus.js`, `src/api/zeusApi.js`, capability/tool metadata, and public
docs). Changes to these decisions require a new ADR or revision with explicit compatibility and
security analysis.
