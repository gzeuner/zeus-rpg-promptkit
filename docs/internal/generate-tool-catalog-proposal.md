# Proposal: `generate-tool-catalog` Command

## Goal

Add a CLI command that auto-generates `docs/tool-catalog.md` directly from runtime command metadata.

## Proposed Command

```bash
node cli/zeus.js generate-tool-catalog [--output docs/tool-catalog.md] [--format markdown|json]
```

## Scope

1. Parse command registry from `cli/zeus.js` and command modules.
2. Include safety levels from static metadata per command.
3. Include workflow presets from `src/workflow/workflowPresetRegistry.js`.
4. Emit deterministic markdown table and optional JSON representation.

## Benefits

- Prevents drift between CLI implementation and documentation.
- Improves onboarding consistency for all AI assistants.
- Enables CI checks for catalog freshness.

## Implementation Suggestion

1. Introduce command metadata map (name, purpose, safety, example).
2. Add generator service under `src/docs/toolCatalogGenerator.js`.
3. Add `src/cli/commands/generateToolCatalogCommand.js`.
4. Add CI check comparing generated output with committed `docs/tool-catalog.md`.

