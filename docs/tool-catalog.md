<!-- 
AUTO-GENERATED FILE – do not edit manually!
Regenerate with: zeus docs:generate-catalog
Last generated: 2026-07-12T00:00:00.000Z
-->

---
Title: Zeus RPG PromptKit Tool Catalog
Description: Verbindlicher, sicherheitsklassifizierter Katalog aller CLI-Befehle und Workflow-Presets fuer Menschen und KI-Assistenten.
Last Updated: 2026-07-12
---

# Zeus RPG PromptKit Tool Catalog

Package: `zeus-rpg-promptkit@0.2.0-beta.2`

This document is the authoritative tool reference for Zeus RPG PromptKit.
All AI assistants (GPT, Claude, Grok, Copilot, local agents) should treat this file as the single source of truth for command purpose, risk level, and usage.

Related:
- [`index.md`](index.md)
- [`ai/session-prompt.md`](ai/session-prompt.md)
- [`cli/reference.md`](cli/reference.md)

## Safety Levels

| Level | Meaning | Typical Action |
|---|---|---|
| `S0` | Local read-only | Read local files, inspect generated artifacts. |
| `S1` | Local write | Create or update local artifacts in the workspace only. |
| `S2` | Remote read-only | Read from IBM i/DB2 without mutations. |
| `S3` | Controlled write | Data mutation with explicit user approval only. |
| `S4` | High-risk / operator-gated | Bridge/apply/compile style operations; never implicit. |

## AI Execution Rules (Mandatory)

1. Default to read-only behavior (`S0`/`S2`).
2. Require explicit user approval before any `S3` or `S4` action.
3. Never execute destructive or production-impacting actions implicitly.
4. Prefer local preparation plus explicit diff/report output.
5. Always report exact command lines before execution when risk is non-trivial.

## CLI Command Catalog

| Command | Aliases | Status | Safety | Scope | Side Effects | Availability | Capability | Purpose | Example |
|---|---|---|---|---|---|---|---|---|---|
| `doctor` | — | `stable` | `S0` | Local | none | cli, api, mcp | `configure.doctor` | Validate runtime, profiles, Java/runtime wiring, and env contracts. | `node cli/zeus.js doctor --profile default --show-resolved` |
| `secret` | — | `stable` | `S1` | Local | local-secret-write | cli | — | Manage encrypted credentials (Secret Vault). Create key (init-key [--windows] for DPAPI on Windows), encrypt/decrypt values (enc:v1:...) for .env or profiles. Transparent decryption at runtime. Never store plaintext passwords. Supports migrate, check (with --warn-only), status. | `node cli/zeus.js secret init-key --windows && node cli/zeus.js secret encrypt --value "myDbPass"` |
| `profiles` | — | `stable` | `S0` | Local | none | cli, api, mcp | `configure.profiles` | List profiles and show masked runtime defaults and resolved routing hints. | `node cli/zeus.js profiles --profile default --show-env` |
| `resources` | — | `stable` | `S0` | Local | none | cli, api, mcp | `configure.resources` | Show resolved resource model (Source/Objects/Metadata/Data) per system. | `node cli/zeus.js resources --profile dev --json` |
| `discover-environment` | — | `stable` | `S2` | IBM i read | remote-read | cli, api, mcp | `configure.discover-environment` | Read-only auto-discovery of libraries/source-files/members/tables + resource suggestion. | `node cli/zeus.js discover-environment --profile dev --json` |
| `fetch` | — | `stable` | `S2` | IBM i read | remote-read, local-artifact-write | cli, mcp | — | Fetch source members/IFS content into the local workspace. Supports --system <name> to select a named profile system at operator request without changing the loaded profile. | `node cli/zeus.js fetch --profile combined-fetch-and-query --system dev` |
| `fetch-member` | — | `stable` | `S2` | IBM i read | remote-read, local-artifact-write | cli, mcp | — | Fetch one or more specific source members into a local output directory. | `node cli/zeus.js fetch-member --profile default --lib APPLIB --member ORDERPGM` |
| `analyze` | — | `stable` | `S1` | Local | local-artifact-write | cli, api, mcp | `analysis.analyze` | Analyze RPG/CL/DDS and generate evidence artifacts. Supports --optimize-context, --dense [lite\|full\|ultra] (rank-aware token reduction + compaction), --prompt-max-tokens, --skip-db2-metadata, --reproducible for large programs and CI stability. | `node cli/zeus.js analyze --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context --dense ultra --prompt-max-tokens 4000` |
| `investigate` | `investigation` | `stable` | `S1` | Local | local-artifact-write | cli, api | `investigation.investigate` | Start or resume a focused investigation session on top of existing analysis artifacts. Enables scoped, iterative deep-dives (focus, search, impact, generate-prompt) with persistent state through the CLI and in-process API. | `node cli/zeus.js investigate --program ORDERPGM --profile dev --goal "Focus on error paths" --focus "error paths" --search "dynamic sql" --generate-prompt` |
| `workflow` | — | `stable` | `S1` | Local | local-artifact-write | cli, api, mcp | `analysis.workflow` | Run preset-guided analyze and bundle flow. Supports --dense (forwarded to analyze steps). | `node cli/zeus.js workflow --preset architecture-review --source ./rpg_sources --program ORDERPGM --out ./output --dense ultra` |
| `workflow run` | — | `stable` | `S1` | Local | local-artifact-write | cli | — | Run workflow definitions from profile/runtime configuration. --dense [lite\|full\|ultra] is supported and forwarded to inner analyze steps (rank-aware token reduction & compaction). | `node cli/zeus.js workflow run --profile default --preset onboarding --out ./output --dense full` |
| `bundle` | — | `stable` | `S1` | Local | local-artifact-write | cli, api, mcp | `bundle.create` | Package analysis artifacts for sharing and review. | `node cli/zeus.js bundle --program ORDERPGM --source-output-root ./output --include-md --include-json` |
| `impact` | — | `stable` | `S1` | Local | local-artifact-write | cli, api, mcp | `investigation.impact` | Build reverse-impact analysis by target or field. | `node cli/zeus.js impact --field RECORD_ID --program ORDERPGM --source ./rpg_sources --out ./output` |
| `assess-risk` | — | `stable` | `S1` | Local | local-artifact-write | cli, api, mcp | `investigation.assess-risk` | Produce a risk-oriented summary for a program. | `node cli/zeus.js assess-risk --program ORDERPGM --out ./output` |
| `generate-test` | — | `stable` | `S1` | Local | local-artifact-write | cli, api, mcp | `investigation.generate-test` | Generate test plan or test template artifacts. | `node cli/zeus.js generate-test --program ORDERPGM --format markdown --out ./output` |
| `generate-checklist` | — | `stable` | `S1` | Local | local-artifact-write | cli, api, mcp | `investigation.generate-checklist` | Generate deployment and change checklist artifacts. | `node cli/zeus.js generate-checklist --program ORDERPGM --type BOTH --impact HIGH --out ./output` |
| `query-table` | — | `stable` | `S2` | DB2 read | remote-read | cli, mcp | — | Query DB2 table metadata. Supports --json for machine readable output. | `node cli/zeus.js query-table --profile default --table APP_TABLE_00 --schema APPDATA --json` |
| `resolve-object` | — | `stable` | `S2` | DB2 read | remote-read | cli, mcp | — | Resolve SQL/system object names and optionally verify required columns. | `node cli/zeus.js resolve-object --profile default --table APP_TABLE_00 --require-column STATUS` |
| `query-sql` | `sql` | `stable` | `S2` | DB2 read | remote-read | cli, mcp | — | Run one or more read-only SQL statements (SELECT/WITH). Semicolon-separated --sql and --file batches execute through one DB2 runner call. | `node cli/zeus.js query-sql --profile default --sql "SELECT * FROM QSYS2.SYSTABLES FETCH FIRST 10 ROWS ONLY; SELECT CURRENT_USER FROM SYSIBM.SYSDUMMY1"` |
| `joblog` | — | `stable` | `S2` | IBM i read | remote-read | cli, mcp | — | Inspect IBM i joblog messages. | `node cli/zeus.js joblog --profile default --severity ERROR --max-messages 100` |
| `field-search` | — | `stable` | `S2` | Local + IBM i read | local-read, remote-read | cli, api, mcp | `investigation.field-search` | Find field/table usage in local sources and or remote members. | `node cli/zeus.js field-search --profile default --field FIELD_ALPHA --table APP_TABLE --source ./rpg_sources --mode all` |
| `trace` | — | `stable` | `S2` | Local + IBM i read | local-read, remote-read | cli, api | `investigation.trace` | Trace data and value lineage across programs and tables. | `node cli/zeus.js trace --value 123 --start-table ORDERS --profile default` |
| `xref` | — | `stable` | `S2` | Local + IBM i read | local-read, remote-read | cli, api | `investigation.xref` | Build a who-calls or who-uses cross-reference for programs and tables. | `node cli/zeus.js xref --program ORDERPGM --profile default` |
| `validate-rpg-sql` | `validate-rpgsql` | `stable` | `S1` | Local | local-artifact-write | cli, mcp | — | Validate embedded SQL in RPG sources for cursor/fetch mismatches, dynamic SQL patterns and host variable issues. Uses scanner + sqlRpgValidator. | `node cli/zeus.js validate-rpg-sql --source ./rpg_sources --program ORDERPGM --format markdown --out ./output` |
| `onboarding` | `wizard`, `onboard`, `zeus-onboarding-wizard` | `stable` | `S1` | Local | local-config-write, remote-read | cli, mcp | — | Interactive zeus-onboarding-wizard. Guides through profile setup, doctor checks, source/object discovery, first fetch and analyze for a new IBM i system. | `node cli/zeus.js onboarding` |
| `search-source` | — | `stable` | `S0` | Local | local-read | cli, api, mcp | `investigation.search-source` | Search the local source tree by term, member, or table. | `node cli/zeus.js search-source --source-root ./rpg_sources --search-term "CHAIN(" --max-results 50` |
| `copy-to-workspace` | — | `stable` | `S1` | Local | local-artifact-write | cli, mcp | — | Copy fetched source members into the active workspace. | `node cli/zeus.js copy-to-workspace --profile default --members ORDERPGM,INVOICEPGM` |
| `diff` | — | `stable` | `S2` | IBM i read + local | remote-read | cli, mcp | — | Compare local source members with IBM i members. | `node cli/zeus.js diff --profile default --member ORDERPGM` |
| `serve` | — | `experimental` | `S0` | Local | local-listener | cli, mcp | — | Start the optional local artifact viewer and experimental UI shell. | `node cli/zeus.js serve --source-output-root ./output --host 127.0.0.1 --port 4782` |
| `qa` | — | `stable` | `S1` | Local | local-artifact-write | cli, api, mcp | `investigation.qa` | Render QA validations/checks to jira, markdown, or json. | `node cli/zeus.js qa --input ./output/ORDERPGM --format markdown --strict STRICT` |
| `inspect-object` | — | `stable` | `S2` | IBM i read | remote-read | cli, mcp | — | Read object metadata and journaling details. | `node cli/zeus.js inspect-object --profile default --lib APPLIB --name APP_TABLE_00 --type *FILE --journal` |
| `test-run` | — | `stable` | `S2` | DB2 read + local | remote-read, local-artifact-write | cli, mcp | — | Capture before and after test snapshots plus rollback SQL text. | `node cli/zeus.js test-run start --profile default --program ORDERPGM --table APPLIB.APP_TABLE_00 --key ID=1` |
| `write-sql` | — | `stable` | `S3` | DB2 write | remote-write | cli, mcp | — | Execute one or more guarded DML statements with confirmation, backup, and safety preflight options. | `node cli/zeus.js write-sql --profile default --sql "DELETE FROM APPDATA.APP_TABLE_00 WHERE STATUS='X'" --confirm --backup` |
| `upsert` | — | `stable` | `S3` | DB2 write | remote-write | cli | — | DML wrapper for INSERT/UPDATE/DELETE/MERGE with guardrails. | `node cli/zeus.js upsert --profile default --sql "UPDATE APPDATA.APP_TABLE_00 SET STATUS='X' WHERE ID=1"` |
| `upsert-sql` | — | `stable` | `S3` | DB2 write | remote-write | cli | — | Backward-compatible alias for the upsert flow. | `node cli/zeus.js upsert-sql --profile default --sql "INSERT INTO APPDATA.APP_TABLE_00 (ID) VALUES (1)"` |
| `insert` | — | `stable` | `S3` | DB2 write | remote-write | cli | — | Strict insert-only DML command. | `node cli/zeus.js insert --profile default --sql "INSERT INTO APPDATA.APP_TABLE_00 (ID) VALUES (1)"` |
| `update` | — | `stable` | `S3` | DB2 write | remote-write | cli | — | Strict update-only DML command. | `node cli/zeus.js update --profile default --sql "UPDATE APPDATA.APP_TABLE_00 SET STATUS='Y' WHERE ID=1"` |
| `delete` | — | `stable` | `S3` | DB2 write | remote-write | cli | — | Strict delete-only DML command with the shared write-safety guardrails. | `node cli/zeus.js delete --profile default --sql "DELETE FROM APPDATA.APP_TABLE_00 WHERE STATUS='X'" --confirm --backup` |
| `analyses` | — | `stable` | `S1` | Local | local-artifact-write | cli, mcp | — | List, register, inspect, and open locally tracked analysis artifacts. | `node cli/zeus.js analyses list --profile default` |
| `bridge` | — | `experimental` | `S4` | Operator-gated | operator-gated | cli, mcp | — | Bridge planning/staging/apply/compile/report flow; never implicit. | `node cli/zeus.js bridge plan --profile default --help` |
| `pui-edit` | — | `experimental` | `S1` | Local | local-artifact-write | cli, mcp | — | Apply structured UI edit operations to local display artifacts. | `node cli/zeus.js pui-edit --file ./display/DSPFILE.MBR --action plan --changes-file ./changes.json` |
| `pui-inspect` | — | `experimental` | `S0` | Local | local-read | cli, mcp | — | Inspect a local Profound UI display-file projection and optionally trace field bindings. | `node cli/zeus.js pui-inspect --file ./display/DSPFILE.MBR --json` |
| `docs:generate-catalog` | `docs generate-catalog` | `stable` | `S1` | Local | local-artifact-write | cli, mcp | — | Regenerate docs/tool-catalog.md (and optional JSON projection) from the CLI command surface; also callable as `zeus docs generate-catalog`. | `node cli/zeus.js docs:generate-catalog` |
| `mcp` | — | `stable` | `S0` | Local read-mostly | local-process-stdio | cli | — | Start local MCP stdio server for safe read-mostly Zeus tool exposure with allowlist policy gating, guarded write controls, and opaque cursor pagination on supported tools. | `node cli/zeus.js mcp serve --verbose --allow-tools zeus.health,zeus.version,zeus.profiles,zeus.doctor,zeus.help,zeus.onboarding,zeus.analyze,zeus.workflow,zeus.bundle,zeus.search-source,zeus.field-search,zeus.resolve-object,zeus.inspect-object,zeus.query-table,zeus.query-sql,zeus.impact,zeus.assess-risk,zeus.generate-test,zeus.generate-checklist,zeus.qa,zeus.validate-rpg-sql,zeus.analyses,zeus.fetch-member,zeus.diff,zeus.copy-to-workspace,zeus.joblog,zeus.docs-generate-catalog,zeus.serve,zeus.test-run` |

## Workflow Presets

| Preset | Analyze Mode | Goal |
|---|---|---|
| `architecture-review` | `architecture` | Run a structure-first analysis and package graph, architecture, and documentation artifacts together. |
| `dependency-risk` | `defect-analysis` | Package defect-oriented prompts and dependency artifacts for risk review and follow-up investigation. |
| `modernization-review` | `modernization` | Bundle modernization prompts, semantic architecture evidence, and change-boundary artifacts. |
| `onboarding` | `documentation` | Produce a concise starter bundle for engineers who need orientation and documentation quickly. |
| `refactoring-review` | `refactoring` | Bundle architecture and refactoring prompts with dependency evidence for small-scope change planning. |
| `security-review` | `security` | Bundle security-analysis prompt with evidence artifacts for IBM i RPG security risk review. |
| `test-generation-review` | `test-generation` | Bundle documentation and test-generation prompts with evidence for scenario and fixture planning. |

## Recommended AI Operating Sequence

1. `doctor` (environment contract)
2. `fetch` (only if source refresh is needed and approved)
3. `analyze` or `workflow --preset ...`
4. `query-table`/`query-sql`/`joblog`/`field-search`/`search-source`/`inspect-object` for evidence deepening
5. `impact`/`assess-risk`/`generate-test`/`generate-checklist`/`qa` for planning and validation
6. generated artifacts and `bundle` for review/sharing; optional `serve` for local viewing
7. `upsert`/`upsert-sql`/`insert`/`update` only after explicit user approval
8. `bridge` only in operator-gated, explicitly approved flows

## How To Keep This File Up To Date

- Regenerate with `zeus docs:generate-catalog` after CLI command-surface changes.
- Public command contracts live in `src/docs/toolCatalogMetadata.js`.
- The generator validates public CLI routes against those declarative contracts and fails closed on drift.
