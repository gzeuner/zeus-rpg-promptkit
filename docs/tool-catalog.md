# Zeus RPG PromptKit Tool Catalog

This document is the authoritative tool reference for Zeus RPG PromptKit.
All AI assistants (GPT, Claude, Grok, Copilot, local agents) should treat this file as the single source of truth for command purpose, risk level, and usage.

## Safety Levels

| Level | Meaning | Typical Action |
|---|---|---|
| `S0` | Local read-only | Read local files, inspect generated artifacts |
| `S1` | Local write | Create/update local artifacts in workspace only |
| `S2` | Remote read-only | Read from IBM i / DB2 without mutations |
| `S3` | Controlled write | Data mutation with explicit user approval only |
| `S4` | High-risk / operator-gated | Bridge/apply/compile style operations; never implicit |

## AI Execution Rules (Mandatory)

1. Default to read-only behavior (`S0`/`S2`).
2. Require explicit user approval before any `S3` or `S4` action.
3. Never execute destructive or production-impacting actions implicitly.
4. Prefer local preparation plus explicit diff/report output.
5. Always report exact command lines before execution when risk is non-trivial.

## CLI Command Catalog

| Command | Safety | Scope | Purpose | Example |
|---|---|---|---|---|
| `doctor` | `S0` | Local | Validate environment, profiles, Java/runtime wiring | `node cli/zeus.js doctor --profile default --show-resolved` |
| `fetch` | `S2` | IBM i read | Fetch source members/IFS content into local workspace | `node cli/zeus.js fetch --profile default-fetch` |
| `analyze` | `S1` | Local | Analyze RPG/CL/DDS and generate evidence artifacts | `node cli/zeus.js analyze --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context` |
| `workflow` | `S1` | Local | Run preset-guided analyze/bundle flows | `node cli/zeus.js workflow --preset architecture-review --source ./rpg_sources --program ORDERPGM` |
| `workflow run` | `S1` | Local | Run workflow definitions from profile/runtime config | `node cli/zeus.js workflow run --profile default --preset onboarding --out ./output` |
| `bundle` | `S1` | Local | Package analysis artifacts for sharing/review | `node cli/zeus.js bundle --program ORDERPGM --profile default --include-md --include-json` |
| `impact` | `S1` | Local | Build reverse-impact analysis by target or field | `node cli/zeus.js impact --field RECORD_ID --program ORDERPGM --source ./rpg_sources --out ./output` |
| `assess-risk` | `S1` | Local | Produce risk-oriented summary for a program | `node cli/zeus.js assess-risk --program ORDERPGM --out ./output` |
| `generate-test` | `S1` | Local | Generate test plan/test template artifacts | `node cli/zeus.js generate-test --program ORDERPGM --format markdown --out ./output` |
| `generate-checklist` | `S1` | Local | Generate deployment/change checklist | `node cli/zeus.js generate-checklist --program ORDERPGM --type BOTH --impact HIGH --out ./output` |
| `query-table` | `S2` | DB2 read | Query DB2 table metadata | `node cli/zeus.js query-table --profile default --table APP_TABLE_00 --schema APPDATA` |
| `query-sql` | `S2` | DB2 read | Run read-only SQL (`SELECT`/`WITH`) | `node cli/zeus.js query-sql --profile default --sql "SELECT * FROM QSYS2.SYSTABLES FETCH FIRST 10 ROWS ONLY"` |
| `joblog` | `S2` | IBM i read | Inspect IBM i joblog messages | `node cli/zeus.js joblog --profile default --severity ERROR --max-messages 100` |
| `upsert` | `S3` | DB2 write | DML wrapper for `INSERT/UPDATE/DELETE/MERGE` with production guardrail | `node cli/zeus.js upsert --profile default --sql "UPDATE APPDATA.APP_TABLE_00 SET STATUS='X' WHERE ID=1"` |
| `upsert-sql` | `S3` | DB2 write | Backward-compatible alias of upsert flow | `node cli/zeus.js upsert-sql --profile default --sql "INSERT INTO APPDATA.APP_TABLE_00 (ID) VALUES (1)"` |
| `insert` | `S3` | DB2 write | Strict insert-only DML command | `node cli/zeus.js insert --profile default --sql "INSERT INTO APPDATA.APP_TABLE_00 (ID) VALUES (1)"` |
| `update` | `S3` | DB2 write | Strict update-only DML command | `node cli/zeus.js update --profile default --sql "UPDATE APPDATA.APP_TABLE_00 SET STATUS='Y' WHERE ID=1"` |
| `field-search` | `S0/S2` | Local + IBM i read | Find field/table usage in local sources and/or remote members | `node cli/zeus.js field-search --profile default --field FIELD_ALPHA --table APP_TABLE --source ./rpg_sources --mode all` |
| `search-source` | `S0` | Local | Search local source tree by term/member/table | `node cli/zeus.js search-source --source-root ./rpg_sources --search-term "CHAIN(" --max-results 50` |
| `copy-to-workspace` | `S1` | Local | Copy fetched source members into working location | `node cli/zeus.js copy-to-workspace --profile default --members ORDERPGM,INVOICEPGM` |
| `diff` | `S2` | IBM i read + local | Compare local member vs IBM i member | `node cli/zeus.js diff --profile default --member ORDERPGM` |
| `serve` | `S0` | Local | Start local artifact viewer/API shell | `node cli/zeus.js serve --source-output-root ./output --host 127.0.0.1 --port 4782` |
| `qa` | `S1` | Local | Render QA validations/checks to jira/markdown/json | `node cli/zeus.js qa --input ./output/ORDERPGM --format markdown --strict STRICT` |
| `inspect-object` | `S2` | IBM i read | Read object metadata/journaling details | `node cli/zeus.js inspect-object --profile default --lib APPLIB --name APP_TABLE_00 --type *FILE --journal` |
| `test-run` | `S2/S1` | DB2 read + local | Capture before/after test snapshots and rollback SQL text | `node cli/zeus.js test-run start --profile default --program ORDERPGM --table APPLIB.APP_TABLE_00 --key ID=1` |
| `bridge` | `S4` | Operator-gated | Experimental bridge planning/staging/apply/compile/report flow | `node cli/zeus.js bridge plan --profile default --help` |
| `pui-edit` | `S1` | Local | Apply structured UI edit operations to local display artifacts | `node cli/zeus.js pui-edit --file ./display/DSPFILE.MBR --action plan --changes-file ./changes.json` |

## Workflow Presets

| Preset | Analyze Mode | Goal |
|---|---|---|
| `onboarding` | `documentation` | Fast orientation bundle for new engineers |
| `architecture-review` | `architecture` | Structure-first architecture review package |
| `security-review` | `security` | Security-focused evidence and prompt bundle |
| `modernization-review` | `modernization` | Modernization readiness and seams review |
| `dependency-risk` | `defect-analysis` | Blast-radius and dependency risk assessment |
| `refactoring-review` | `refactoring` | Small-scope refactoring planning bundle |
| `test-generation-review` | `test-generation` | Scenario/fixture planning for tests |

## Recommended AI Operating Sequence

1. `doctor` (environment contract)
2. `fetch` (if source refresh is needed and approved)
3. `analyze` or `workflow --preset ...`
4. `query-table` / `query-sql` / `field-search` for evidence deepening
5. `impact` / `assess-risk` / `generate-test` / `generate-checklist`
6. `bundle` / `serve` for review and sharing
7. `upsert`/`insert`/`update` only after explicit user approval

