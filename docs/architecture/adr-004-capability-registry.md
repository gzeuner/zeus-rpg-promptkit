# ADR-004: Capability Registry

**Status:** Accepted

## Context

Zeus exposes many capabilities to users and agents:

- CLI commands (analyze, fetch, impact, workflow, investigate, bridge, query-*, serve, docs:generate-catalog, etc.)
- Subcommands and workflow presets
- Analysis stages
- MCP tools and resources
- Prompt templates and workflow modes
- Diagnostic packs, investigation actions

Two complementary metadata systems currently exist (inspected):

1. `src/cli/commandMetadata.js` — rich per-command records including:
   - name, title, summary, category (configure/fetch/analyze/query/review/context)
   - primaryUseCase, requiredCapabilities, commonOptions, advancedOptions
   - outputArtifacts, recommendedNextCommands

2. `src/docs/toolCatalogMetadata.js` — authoritative for generation:
   - SAFETY_LEVELS
   - Per-command entries with `safety`, `scope`, `purpose`, `example`
   - Also exports COMMAND_METADATA, COMMAND_ORDER, MANDATORY_AI_RULES, RECOMMENDED_AI_SEQUENCE

The catalog is produced by `cli/commands/generate-tool-catalog.js` (which also walks source for usage lines) + `src/docs/toolCatalogGenerator.js`. Output is `docs/tool-catalog.md` (and optional .json). The file header explicitly says "AUTO-GENERATED FILE – do not edit manually!"

Additional registries (pluggable capabilities):

- `src/analyze/stageRegistry.js` + `createAnalyzeStageRegistry`
- `src/api/zeusApi.js` — ComponentRegistry base + AnalyzerRegistry, McpToolRegistry
- `src/workflow/workflowPresetRegistry.js`, `workflowModeRegistry.js`
- `src/prompt/promptRegistry.js`
- `src/investigation/diagnosticPackRegistry.js`
- MCP registration in `src/mcp/mcpTools.js`

The acceptance criteria for package 01 require a capability descriptor to include at minimum: ID, aliases, category, safety level, side effects, input contract, output contract, availability, execution handler, and documentation metadata.

Current metadata is close but not yet a single unified descriptor shape.

## Decision

Treat the existing metadata + generator + registries as the **capability registry strategy** for Zeus:

- Command and tool metadata in `src/docs/toolCatalogMetadata.js` + `src/cli/commandMetadata.js` (and the generator) are the primary source of truth for CLI/MCP-facing capabilities.
- Registries in `src/analyze/`, `src/api/zeusApi.js`, `src/workflow/`, `src/prompt/`, and `src/mcp/` provide runtime pluggability for stages, analyzers, tools, presets, and templates.
- Over time, evolve the metadata shape toward the full descriptor (ID + aliases + category + safety + side effects + input/output contracts + availability + execution handler ref + docs).
- All new capabilities must be registered through one of the supported mechanisms and must declare a safety level (see ADR-005).
- The generated `docs/tool-catalog.md` remains the published, AI-consumable contract.
- Never hand-edit generated catalog output.

Side effects (local write, remote read, controlled mutation) are expressed via safety level + requiredCapabilities + scope today and will be made more explicit in the descriptor.

Execution handler is currently the command runner module + the registered function; for stages/tools it is the run function provided at registration.

## Consequences

- Adding a capability = add metadata entry + (if pluggable) register it + update tests/docs + regenerate catalog.
- The dual metadata sources should be reconciled or clearly layered rather than duplicated.
- Future agent guidance (including copilot instructions) should direct changes through the registry pattern rather than ad-hoc if/else in `cli/zeus.js`.
- Documentation generation becomes part of the definition of a capability.

## Compatibility Implications

- Existing commands and their documented contracts remain stable.
- New fields added to metadata are additive.
- Registries already support registration without breaking existing entries.

## Security Implications

Safety level and side-effect declaration are first-class on capabilities. This enables:

- Pre-flight checks (doctor)
- Policy enforcement (MCP, bridge approval)
- Safe-sharing and redaction decisions
- Clear separation of S0–S4 surfaces

## Incremental Adoption Path

- Package 01: Formalize the current strategy in this ADR. The required descriptor fields are documented as the target shape.
- Later packages that introduce or refactor commands/tools/stages must add or update metadata entries and ensure the generator still produces correct output.
- A future package may introduce a unified `CapabilityDescriptor` type or builder if the two metadata files become painful.

## Alternatives Considered

- Single giant registry object that everything registers into at startup. Rejected: current mix of static metadata (for docs + discovery) + runtime registries (for pluggability) is pragmatic and already works.
- Put all metadata only in JSDoc or source comments. Rejected: hard to query, hard to generate the catalog, and less reliable than dedicated metadata modules.
- Make the tool catalog the source of truth (reverse generation). Rejected: loses the ability to drive behavior and validation from code/metadata.

## Conditions to Revisit

- The number of places that must be touched to add a safe, documented command becomes a measurable drag.
- A need arises for dynamic discovery of capabilities by external tools (beyond the generated catalog).
- MCP tool surface and CLI command surface diverge significantly and need a common descriptor model.
