---
Title: Zeus RPG PromptKit Architecture Documentation
Description: Accepted architecture decisions, kernel definition, dependency rules, contracts, capability model, safety trust zones, open-core module boundaries, and ZPI baseline contracts.
Last Updated: 2026-07-22
---

# Architecture Documentation

This directory contains the authoritative architecture baseline for Zeus RPG PromptKit.

All subsequent implementation and agent guidance must be consistent with these decisions.

## Accepted Architecture Decision Records (ADRs)

| ADR | Title | Status |
| --- | ----- | ------ |
| [001](adr-001-product-kernel.md) | Product Kernel | Accepted |
| [002](adr-002-dependency-direction.md) | Dependency Direction | Accepted |
| [003](adr-003-versioned-contracts.md) | Versioned Contracts | Accepted |
| [004](adr-004-capability-registry.md) | Capability Registry | Accepted |
| [005](adr-005-safety-trust-zones.md) | Safety Trust Zones | Accepted |
| [006](adr-006-commercial-extension-architecture.md) | Commercial Extension Architecture | Accepted specification |
| [007](adr-007-provider-neutral-contracts.md) | Provider-Neutral AI Contracts | Accepted |
| [008](adr-008-generation-validation-foundation.md) | Generation Validation Foundation | Accepted |
| [009](adr-009-project-intelligence-ownership.md) | Project Intelligence Ownership Split | Accepted for ZPI-01 |
| [010](adr-010-default-store-and-search.md) | Default Store and Search Architecture | Accepted for ZPI-01 |
| [011](adr-011-evidence-and-provenance.md) | Evidence and Provenance Model | Accepted for ZPI-01 |
| [012](adr-012-snapshots-and-migrations.md) | Snapshots and Migrations | Accepted for ZPI-01 |
| [013](adr-013-retrieval-and-context-policy.md) | Retrieval and Context Policy | Accepted for ZPI-01 |

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
  rules captured in ADR-009 through ADR-013.
- External modules must use the trusted in-process registrar and module descriptor contracts
  (ADR-006 executable subset; see `docs/modules/authoring-external-module-registration.md`).
  The core never enforces commercial licenses.

## Regenerating Supporting Artifacts

```bash
node cli/zeus.js docs:generate-catalog
```

The tool catalog (`../tool-catalog.md`) is the published surface of the capability model.

## Governance

These ADRs were created as part of package 01 to establish a verified baseline before further packages. They are grounded in the actual module structure, metadata, and contracts present on main at the time of writing (see inspection of `cli/zeus.js`, `src/api/zeusApi.js`, `src/docs/toolCatalogMetadata.js`, `src/cli/commandMetadata.js`, `src/analyze/analyzeRunManifest.js`, `src/core/`, `src/bridge/`, `src/config/`, `docs/`, `README.md`, and `.github/copilot-instructions.md`).

Changes to these decisions require a new ADR or revision with explicit compatibility and security analysis.
