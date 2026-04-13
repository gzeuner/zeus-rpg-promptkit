# Analyzer Stage Pipeline

The analyze runtime is now built around a registry-backed stage pipeline instead of one hard-coded stage list in the CLI path.

## Goals

- keep `runAnalyzeCore(...)` as the semantic-core entry point
- allow new internal stages to be added without editing multiple orchestration paths
- preserve deterministic stage ordering and artifact contracts
- expose stage metadata and diagnostics for manifests and debugging

## Stage contract

Each analyze stage is a plain object with:

- `id`: stable unique stage identifier
- `run(state)`: synchronous stage execution function returning the next state object
- `title` (optional): human-readable label for manifests and debugging
- `description` (optional): short explanation of what the stage does
- `category` (optional): coarse grouping such as `scan`, `analysis`, `db2`, or `investigation`
- `before` / `after` (optional): ordering anchors against other stage ids
- `beforeRun`, `afterRun`, `onError` (optional): stage-local lifecycle hooks

Stage output stays on the existing runtime contract:

- merge additional state into the returned object
- expose stage-local debug metadata through `stageMetadata`
- expose stage-local warnings or notes through `stageDiagnostics`

## Registry contract

`createAnalyzeStageRegistry()` supports:

- `registerStage(definition)`
- `registerLifecycleHooks(hooks)`
- `use(plugin)`
- `resolveStages()`
- `resolveLifecycleHooks()`

Registered stages are ordered through deterministic topological sorting:

- registration order is the stable tiebreaker
- `before` and `after` anchors are validated
- unknown anchors fail fast
- cycles fail fast

## Plugin contract

An analyze plugin is an internal object with:

- `name`
- `register(api)`

The `register(api)` callback receives:

- `registerStage(definition)`
- `registerLifecycleHooks(hooks)`
- `listStages()`
- `listLifecycleHooks()`

This is intentionally an internal extension seam, not a public plugin marketplace. The current goal is to let new analyzer stages be introduced behind a stable contract while keeping CLI behavior deterministic.

## Lifecycle hooks

Lifecycle hooks are observational by design. They allow instrumentation and reporting without replacing the stage run loop.

Supported hooks:

- `beforeStage({ stage, state })`
- `afterStage({ stage, state, nextState, stageReport })`
- `onStageError({ stage, state, error, stageReport })`

The built-in runner also records stage definition metadata in:

- `analysis-diagnostics.json`
- `analyze-run-manifest.json`

That metadata includes the resolved plugin owner, category, ordering anchors, and registration order for each executed stage.

## Built-in stages

Current core stages are still the same semantic pipeline:

1. `collect-scan`
2. `build-context`
3. `investigate-sources`
4. `optimize-context`
5. `export-db2`
6. `export-test-data`
7. `run-diagnostic-packs`
8. `write-artifacts`

Only the registration mechanism changed. The output contract and generated artifact set remain backward-compatible.
