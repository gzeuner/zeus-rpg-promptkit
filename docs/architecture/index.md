---
Title: Zeus RPG PromptKit Architecture Documentation
Description: Accepted architecture decisions, kernel definition, dependency rules, contracts, capability model, and safety trust zones for the Zeus evidence-preparation toolkit.
Last Updated: 2026-07-11
---

# Architecture Documentation

This directory contains the authoritative architecture baseline for Zeus RPG PromptKit.

All subsequent implementation and agent guidance must be consistent with these decisions.

## Accepted Architecture Decision Records (ADRs)

| ADR | Title | Status |
|-----|-------|--------|
| [001](adr-001-product-kernel.md) | Product Kernel | Accepted |
| [002](adr-002-dependency-direction.md) | Dependency Direction | Accepted |
| [003](adr-003-versioned-contracts.md) | Versioned Contracts | Accepted |
| [004](adr-004-capability-registry.md) | Capability Registry | Accepted |
| [005](adr-005-safety-trust-zones.md) | Safety Trust Zones | Accepted |

## Related Reviews

- [Runtime Config Model Review](runtime-config-model-review.md) — details the layered profile and runtime configuration system (pre-dates formal ADRs).

## How to Use These Documents

- New features and refactors must cite relevant ADRs in PR descriptions.
- When adding commands, stages, or MCP tools, follow the capability registry strategy (ADR-004) and declare safety level (ADR-005).
- Data artifacts (manifests, knowledge projections, canonical model) follow versioning rules in ADR-003.
- Code organization must respect the dependency direction (ADR-002).
- The product kernel (ADR-001) defines the stable evidence and artifact production responsibilities.

## Regenerating Supporting Artifacts

```bash
node cli/zeus.js docs:generate-catalog
```

The tool catalog (`../tool-catalog.md`) is the published surface of the capability model.

## Governance

These ADRs were created as part of package 01 to establish a verified baseline before further packages. They are grounded in the actual module structure, metadata, and contracts present on main at the time of writing (see inspection of `cli/zeus.js`, `src/api/zeusApi.js`, `src/docs/toolCatalogMetadata.js`, `src/cli/commandMetadata.js`, `src/analyze/analyzeRunManifest.js`, `src/core/`, `src/bridge/`, `src/config/`, `docs/`, `README.md`, and `.github/copilot-instructions.md`).

Changes to these decisions require a new ADR or revision with explicit compatibility and security analysis.
