# Architecture Review

## Scope Reviewed

The review covered the current repository state across:

- CLI entry points and command flow
- fetch and IBM i export paths
- analyze pipeline and stage execution
- source scanning and dependency extraction
- dependency graphs, impact analysis, and architecture viewer generation
- context building, prompt generation, reports, and bundles
- DB2 metadata and test-data integration
- Java helper integration and test coverage

## Delivery State

This is a real V1, not a stub project.

Verified capabilities in the codebase include:

- `zeus fetch` with member listing, remote export, and three download transports
- `zeus analyze` with staged context generation, reports, prompts, graphs, and viewer output
- `zeus impact` based on the generated cross-program graph
- `zeus bundle` with manifest-driven packaging
- DB2 metadata export and bounded test-data extraction through Java helpers
- automated tests for runtime configuration, analyze staging, manifests, bundle packaging, Java runtime behavior, and a full smoke flow

The current automated suite passed during review with `node --test`.

## Strengths

- The project already has a coherent CLI-centered artifact model. `context.json`, graph files, reports, prompts, manifests, and bundles line up well enough to support real workflows.
- The analyze flow is explicit and understandable. `runStages()` and the staged pipeline make the current orchestration readable and reasonably easy to extend.
- Output structure is disciplined. Graph nodes and edges are normalized and sorted, bundle manifests include checksums, and analyze manifests capture stage metadata and diagnostics.
- DB2 integration is kept behind Java helpers instead of leaking IBM i and JDBC concerns all through the Node.js layer.
- Test-data extraction is bounded and read-only, which is the right default posture for a tool that may run near production-adjacent systems.

## Weaknesses

### IBM i source fidelity and Windows readability

This is the clearest architectural gap.

- The fetch export command is built in [src/fetch/ifsExporter.js](/c:/Java/workspace-java/zeus-rpg-promptkit/src/fetch/ifsExporter.js) and uses `CPYTOSTMF ... STMFCODPAG(*STMF)`.
- No code path explicitly guarantees UTF-8 output for downloaded source members.
- All download transports then move the resulting bytes locally without any normalization step.
- The scanner and related consumers read source files as UTF-8 directly in [src/scanner/rpgScanner.js](/c:/Java/workspace-java/zeus-rpg-promptkit/src/scanner/rpgScanner.js), [src/cli/helpers/sourceSnippet.js](/c:/Java/workspace-java/zeus-rpg-promptkit/src/cli/helpers/sourceSnippet.js), and [src/ai/contextOptimizer.js](/c:/Java/workspace-java/zeus-rpg-promptkit/src/ai/contextOptimizer.js).

That means Windows readability and even successful analysis currently depend on remote/default CCSID behavior. There is no explicit source-normalization contract and no test coverage around mixed encodings, umlauts, or mojibake scenarios.

### Scanner depth vs. product ambition

- The current scanner is intentionally heuristic and lightweight, which is acceptable for V1.
- It does not yet provide procedure/subroutine depth, service program recognition, binder awareness, or robust SQL semantics.
- The default extension list includes CL and DDS types, but scanning is still largely RPG-centric.

### Source identity and ambiguity handling

- Cross-program resolution is basename-driven in [src/dependency/programSourceResolver.js](/c:/Java/workspace-java/zeus-rpg-promptkit/src/dependency/programSourceResolver.js).
- When duplicate member names exist, the first local path wins and the rest are reduced to a warning.

That is not strong enough for larger IBM i estates where identical member names across source files or libraries are normal.

### Reuse boundaries

- `analyzePipeline.js` still mixes orchestration, enrichment, report generation, prompt generation, graph serialization, and viewer writing in one execution path.
- The project is heading toward UI/API reuse, but the internal boundary between core analysis results and output adapters is not strong enough yet.

### Public artifact portability

- The generated architecture viewer in [src/viewer/architectureViewerGenerator.js](/c:/Java/workspace-java/zeus-rpg-promptkit/src/viewer/architectureViewerGenerator.js) loads `vis-network` from a CDN.
- That means the HTML artifact is local-server-free, but not truly offline-portable or version-stable.

## Risks

- Source imports can become unreadable or partially unscannable on Windows when IBM i export CCSID behavior does not match the scanner's UTF-8 assumption.
- Mixed or duplicate member names can produce incorrect cross-program graphs or impact analysis in larger repositories.
- Larger source trees will stress current whole-tree collection and repeated file-read behavior before V2 scalability work lands.
- The public claim of deterministic or portable artifacts is directionally true, but not yet complete because timestamps and CDN dependencies still leak into outputs.

## Recommended Priorities

### Priority 1

- Close the IBM i source fidelity gap end to end: export encoding, local normalization, provenance, and Windows-readable defaults.
- Strengthen source identity and ambiguity handling before pushing harder on cross-program analysis scale.
- Add dedicated CL and DDS scanning so mixed IBM i repositories are first-class rather than incidental.
- Separate core analysis services from filesystem writers so the future UI/API layer can reuse the same contracts.
- Improve reproducibility and scalability to make regression testing and enterprise adoption more credible.

### Priority 2

- Continue prompt-system maturation through prompt packs, validation, and workflow presets.
- Make the architecture viewer offline-capable so bundle artifacts are reliable in restricted environments.

### Priority 3

- Build the local UI on top of shared manifests and analysis contracts, not parallel parsing logic.

## Recommended Next Implementation Step

The next implementation step should be [#55](https://github.com/gzeuner/zeus-rpg-promptkit/issues/55): guarantee UTF-8 IBM i source export and Windows-readable local files.

It removes the highest-risk ingestion weakness, aligns fetch behavior with the current UTF-8 scanner contract, and creates the foundation for the rest of the roadmap.
