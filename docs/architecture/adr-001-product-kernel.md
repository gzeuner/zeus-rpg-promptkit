# ADR-001: Product Kernel

**Status:** Accepted

## Context

Zeus RPG PromptKit is an evidence-preparation layer for IBM i RPG, CL, and DDS source estates. The primary value is turning raw sources (and optional Db2 metadata) into inspectable, reproducible, AI-consumable artifacts.

Inspection of the current implementation (as of main at package 01 baseline) shows the core responsibilities concentrated in:

- `src/context/canonicalAnalysisModel.js` and `src/context/contextBuilder.js` — canonical evidence model
- `src/analyze/` (analyzePipeline.js, analyzeRunManifest.js, analyzeArtifactWriter.js, stageRegistry.js, runStages.js)
- `src/core/*Service.js` (analyzeService, fetchService, impactService, etc.)
- `src/reproducibility/reproducibility.js` — deterministic output controls
- `src/report/` (markdownReport, architectureReport, jsonReport, etc.)
- `src/sharing/safeSharingArtifactBuilder.js`
- `src/investigation/` — post-analysis investigation sessions
- `src/prompt/`, `src/ai/knowledgeProjection.js` — prompt-ready projections
- `src/workflow/` — preset and run manifests
- Manifests: `analyze-run-manifest.json` (MANIFEST_SCHEMA_VERSION = 1 in `src/analyze/analyzeRunManifest.js`), workflow-run-manifest, importManifest
- Public exposure: `cli/zeus.js`, `src/api/zeusApi.js`, MCP tools, `docs/tool-catalog.md`

There is no single "kernel" module today. The behavior is emergent from the orchestration of analysis stages, context building, artifact writing, and reproducibility controls. Safety policy (S-levels) is applied across this surface.

The existing high-level description lives in `README.md` ("How Zeus works"), `docs/safety/best-practice-guide.md`, and `.github/copilot-instructions.md` (Core Data Contracts section).

## Decision

Define the **product kernel** as the combination of:

1. Evidence model (canonical analysis model + relations + source integrity)
2. Investigation and run-manifest facilities
3. Artifact production (reports, graphs, JSON, bundles, prompts)
4. Reproducibility and provenance controls
5. Safety policy classification and enforcement boundaries

The kernel is responsible for:

- Producing deterministic, auditable evidence from sources + optional Db2.
- Maintaining provenance via manifests and import manifests.
- Supporting controlled reduction (dense, optimize-context, safe-sharing).
- Exposing extension points (stage registry, analyzer registry, prompt registry) without owning every use case.

CLI commands, MCP tools, and the public API (`src/api/zeusApi.js`) are thin orchestrators or facades over the kernel. Adapters (fetch, db2, java) and pure domain logic (scanners, dependency graphs, impact) exist to serve the kernel.

## Consequences

- Future packages must keep artifact shapes, manifest fields, and reproducibility behavior stable or versioned explicitly.
- New analysis stages, prompt templates, or investigation capabilities are kernel-adjacent and must declare safety level and contracts.
- The local viewer and bundler consume kernel outputs; they are not part of the kernel itself.
- Documentation (tool-catalog, session prompts, ADRs) must stay synchronized with kernel contracts via generators where possible.

## Compatibility Implications

- Kernel outputs (canonical-analysis.json, ai-knowledge.json, manifests, reports) are the primary public contract for consumers.
- Additive fields are preferred; removals or semantic changes require schemaVersion bump (see ADR-003).
- Existing artifact consumers (including tests in `tests/`) must continue to work.

## Security Implications

The kernel is the point at which untrusted or sensitive IBM i source becomes structured local artifacts. All S-level decisions (read vs write, remote vs local) are applied around kernel execution. Secret masking, safe-sharing sanitization, and redaction occur on kernel outputs or at boundaries.

## Incremental Adoption Path

- Package 01 (this): formalize the definition in ADR.
- Subsequent packages: when touching analysis, reproducibility, or artifact code, reference this ADR and update affected contracts/tests/docs.
- No immediate refactoring of module layout required.

## Alternatives Considered

- Treat "kernel" as only the canonical model builder. Rejected: too narrow; ignores manifests, reproducibility, and safety surface that are equally core to the product's value.
- Introduce a new `src/kernel/` directory immediately. Rejected: would be cosmetic and risk moving production code (forbidden by package constraints). The current organization already reflects the kernel responsibilities across a few focused directories.
- Make the CLI the kernel. Rejected: CLI is a delivery mechanism; the same kernel powers API and MCP.

## Conditions to Revisit

- A major shift to a different primary artifact model (e.g. full IR or language-server protocol).
- Decision to split the project into a reusable evidence library + separate CLI.
- Discovery that a significant portion of value now lives outside the current evidence/artifact/reproducibility/safety surface.
