# ADR-003: Versioned Contracts

**Status:** Accepted

## Context

Zeus produces several machine-readable and human-readable artifacts whose shape is a contract with consumers (developers, AI agents, downstream tools, tests):

- `analyze-run-manifest.json` — `MANIFEST_SCHEMA_VERSION = 1` (see `src/analyze/analyzeRunManifest.js`)
- `ai-knowledge.json` — contains `schemaVersion: 1` (see `src/ai/knowledgeProjection.js` and related)
- Workflow run manifests (`src/workflow/workflowRunManifest.js`)
- Import manifests (`src/fetch/importManifest.js`)
- `canonical-analysis.json` (structure described in `.github/copilot-instructions.md`)
- Tool catalog (`docs/tool-catalog.md` + `.json`) — generated, not hand-edited
- CLI command surface and option contracts (help text + `commandMetadata.js` + usage extraction in generator)
- MCP tool contracts (via `src/mcp/mcpTools.js` and registration)

Currently versioning is light and mostly additive. The generator for the tool catalog (`cli/commands/generate-tool-catalog.js`) rebuilds documentation from code + `src/docs/toolCatalogMetadata.js`. No single "contract version" for the entire product exists beyond package.json semver.

Safety levels, output artifact names, and option semantics are part of the observable contract (documented in `docs/tool-catalog.md`, `README.md`, `docs/ai/session-prompt.md`).

## Decision

Adopt an explicit versioned-contracts policy:

1. **Data artifacts** that are consumed programmatically (manifests, canonical model slices, ai-knowledge projections, bundle contents) must carry a `schemaVersion` (integer or semver). Start at 1 for current shapes.
2. **Additive changes** (new optional fields, new artifact kinds) are allowed within the same major schema version. Consumers must tolerate unknown fields.
3. **Breaking changes** (removal, rename, type change, mandatory new field, semantic change) require:
   - A new major schemaVersion
   - Update to the generator / writer
   - Migration notes or compatibility adapter where feasible
   - Bumped package version following semver
4. **CLI / MCP surface contracts** are versioned implicitly by the generated tool catalog and explicit metadata. Changes are communicated via catalog regeneration + conventional commits / PRs. Aliases are preserved for deprecation windows where practical.
5. **Documentation contracts** (tool-catalog, safety tables, quickstarts) are regenerated from authoritative sources. Hand edits are forbidden (see generator header).
6. The authoritative reference for "what the product promises right now" is the combination of:
   - Generated `docs/tool-catalog.md`
   - SchemaVersion-carrying artifacts in a given run
   - Public README + safety model

Deprecation path: mark in metadata, keep old behavior or alias for at least one minor release, then remove with major version / schema bump.

## Consequences

- Consumers (including internal tests and AI prompts) can detect incompatible artifacts.
- The generator + metadata files become the single source for CLI contracts.
- Adding a field to a manifest is now a deliberate, low-risk act.
- Breaking changes become visible and intentional.

## Compatibility Implications

- Existing runs on schemaVersion 1 continue to be valid.
- Readers should check schemaVersion before assuming full shape.
- Package consumers using the programmatic API (`require('zeus-rpg-promptkit/api')`) see the same stability rules.

## Security Implications

Versioned contracts reduce the risk of silent misinterpretation of evidence (e.g. missing uncertainty markers or provenance). Safe-sharing and redaction behavior should also be reflected in manifest metadata so consumers know whether an artifact has been sanitized.

## Incremental Adoption Path

- Package 01: Document the policy. Existing schemaVersion=1 declarations become the baseline.
- When a later package changes a manifest or projection shape, follow the rules above and update the relevant ADR reference or add a compatibility note.
- No immediate bump or rewrite of current artifacts.

## Alternatives Considered

- "Everything is versioned by package.json only." Rejected: artifacts can outlive a particular CLI version and are often consumed independently.
- Freeze all artifact shapes forever. Rejected: prevents evolution and new value (dense modes, new entity types, etc.).
- Use external schema registry or JSON Schema files for everything. Rejected for initial baseline: pragmatic `schemaVersion` integer + docs + tests is sufficient and already partially present. Can add formal schemas later.

## Conditions to Revisit

- Proliferation of ad-hoc version fields that should be unified.
- Need for forward-compatible deserializers or long-term archive support.
- Decision to publish a standalone evidence model package with its own semver and schemas.
