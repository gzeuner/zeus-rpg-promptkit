# Runtime Config Model Review

This note summarizes the current runtime/profile model and highlights what should stay stable versus what should evolve for a GUI-first experience.

## Scope Reviewed

- `src/config/runtimeConfig.js`
- `src/config/runtimeConfigCore.js`
- `src/config/runtimeConfigDefaults.js`
- `src/config/runtimeConfigEnv.js`
- `src/config/runtimeConfigProfiles.js`
- `src/config/runtimeConfigResolver.js`
- `src/config/runtimeConfigValidation.js`
- `src/config/runtimeConfigWorkflow.js`
- `src/cli/commands/profilesCommand.js`
- `src/cli/commands/doctorCommand.js`
- `config/profiles.example.json`
- `tests/runtime-config*.test.js`

## Config Sources and Precedence

The system already has a clear layered model with explicit parsing and validation.

### Profile file resolution

1. `--config <path>` (CLI) if provided.
2. `ZEUS_CONFIG_DIR` if `--config` is absent.
3. default `./config`.

When a directory is used, load order is:

1. `config/local-only/profiles.json` (preferred private file)
2. `config/profiles.json`
3. `config/profiles.example.json` (safe fallback)
4. optional overlays `profiles.<name>.json` in sorted order

### Value resolution precedence

Per command, the effective model is:

1. command-line overrides (highest)
2. environment variables
3. resolved profile values (after `extends`, merge, env placeholder expansion, system reference resolution)
4. hardcoded defaults

### Profile inheritance and merge behavior

- `extends` supports single string or string array.
- Parent profiles are merged before child profiles.
- Object merge is deep; arrays are replaced, not concatenated.
- Mixin profiles (prefix `_`) are supported and warned when selected directly.
- Cyclic `extends` chains fail fast.

## Current Profile Structure (Supported Contract)

Stable top-level global keys:

- `contextOptimizer`
- `analysisLimits`
- `testData`
- `presets`

Named profiles support:

- `sourceRoot`, `outputRoot`, `extensions`
- `db` and `dbRoles` (`metadata`, `testData`)
- `fetch`
- `workflow` and profile `presets`
- `workCopy`, `tokenBudget`, `bridge`
- optional `productionSystem`, `runtimeContext`, `systems`

Validation is strict and centralized in `runtimeConfigValidation.js`.

## Multiple Systems / Connections

The model already supports multi-system routing:

- Profile-level `systems` map contains reusable host/user/password/schema definitions.
- `db`, `dbRoles.*`, and `fetch` can reference `{ "system": "<name>" }`.
- Inline overrides are allowed on top of referenced system definitions.
- Resolution is deferred to top-level profile resolution so children can override parent references safely.

This is a good foundation for GUI connection cards.

## Option Ownership by Source Type

### CLI-first options (command-time workflow inputs)

- analyze target selectors (`--source`, `--program`, `--member`)
- one-off query inputs (`--sql`, `--file`, `--table`, `--filter`)
- runtime toggles (`--safe-sharing`, `--reproducible`, `--show-resolved`)
- transient fetch filters (`--members`, `--files`)

These should stay command-time inputs, not mandatory saved profile fields.

### Env-first options (sensitive/runtime host credentials)

- `ZEUS_DB_*`, `ZEUS_METADATA_DB_*`, `ZEUS_TESTDATA_DB_*`
- `ZEUS_FETCH_*`
- `ZEUS_OUTPUT_ROOT`, `ZEUS_SOURCE_ROOT`, `ZEUS_ANALYSES_REGISTRY`
- `ZEUS_CONFIG_DIR`

Passwords should remain env-first for GUI integration as well.

### Profile-first options (reusable team defaults)

- source/output roots, extensions
- fetch source library/files, transport defaults
- db role routing and schema preference
- workflow presets and step defaults
- analysis limits, token budgets, work-copy behavior

## What GUI Needs That Is Not Explicit Yet

The runtime model is robust, but GUI rendering currently needs implicit knowledge from multiple modules. A GUI needs an explicit metadata contract for:

- field labels/help/sections
- sensitivity and safe-display flags
- env var linkage
- profile path linkage
- type hints and validation hints
- capability scope (fetch/query/analyze/workflow/etc.)

This iteration adds that under `src/config/configUiMetadata.js`.

## Areas That Are Confusing Today

- Profile naming was historically mixed (`default*`, `sample-*`, newer semantic names).
- Some options appear in CLI, env, and profile simultaneously; this is powerful but hard to explain without a matrix.
- `default` profile name is generic and less workflow-oriented than `dev` / `demo` / `readonly-db2`.
- Command discoverability lives across help text, docs, and tool-catalog metadata rather than one GUI-focused command contract.

## What Is Already Good and Should Stay Stable

- Explicit config precedence with deterministic merge rules.
- Strict validation before command execution.
- Safe public profile template (`profiles.example.json`) and local-only private file flow.
- Multi-role DB configuration (`metadata`, `testData`) and system reference routing.
- Runtime facade (`src/config/runtimeConfig.js`) that keeps internals encapsulated.

## Follow-up Guidance

- Keep runtime behavior backward-compatible while evolving metadata.
- Continue preserving alias profiles for compatibility (`sample-*`) while preferring clearer names in docs/help.
- Add GUI against metadata contracts first; avoid duplicating runtime resolution logic in the UI.
