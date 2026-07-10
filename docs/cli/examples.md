---
Title: CLI Examples
Description: CLI-Referenz- und Praxisdokumentation fuer reproduzierbare Zeus-Befehlsablaeufe.
Last Updated: 2026-07-09
---

# CLI Examples

## Environment and Baseline

```powershell
. .\config\load-env.ps1 -Environment project
node .\cli\zeus.js doctor --profile default --probe --show-resolved
```

## Source Ingest and Analysis

```powershell
node .\cli\zeus.js fetch --profile default-fetch
node .\cli\zeus.js fetch --profile combined-fetch-and-query --system dev --members ORDERPGM
node .\cli\zeus.js analyze --source .\rpg_sources --program ORDERPGM --out .\output --optimize-context --dense full   # optional: lite | full | ultra (rank-aware). Auch via workflow-Befehle.
```

`--system <name>` selects a named profile system by key, `systemName`, or alias. Use it when
the loaded profile contains multiple IBM i targets and the operator explicitly wants source
from a different system without editing the profile.

Optional local known facts can be folded into the analyze context only via explicit opt-in:

```powershell
node .\cli\zeus.js analyze --source .\rpg_sources --program ORDERPGM --profile default --out .\output --with-known-facts
node .\cli\zeus.js analyze --source .\rpg_sources --program ORDERPGM --out .\output --with-known-facts --known-facts-path .\config\local-only\known-facts\default.json
```

## Preset-Driven Workflows

```powershell
node .\cli\zeus.js workflow --preset onboarding --source .\rpg_sources --program ORDERPGM --out .\output
node .\cli\zeus.js workflow --preset architecture-review --source .\rpg_sources --program ORDERPGM --out .\output
```

## DB2 Read-Only Diagnostics

```powershell
node .\cli\zeus.js resolve-object --profile default --table APP_TABLE_00 --require-column CASE_ID --require-column STATUS
node .\cli\zeus.js query-table --profile default --table APP_TABLE_00 --schema APPDATA
node .\cli\zeus.js query-sql --profile default --sql "SELECT TABLE_NAME FROM QSYS2.SYSTABLES FETCH FIRST 20 ROWS ONLY"
node .\cli\zeus.js query-sql --profile default --sql "SELECT CURRENT_USER FROM SYSIBM.SYSDUMMY1; SELECT CURRENT_SERVER FROM SYSIBM.SYSDUMMY1" --output json
node .\cli\zeus.js query-sql --profile default --file .\diagnostics\readonly.sql --output table
node .\cli\zeus.js joblog --profile default --severity ERROR --max-messages 100
```

`query-sql` accepts multiple read-only `SELECT` / `WITH` statements separated by semicolons,
both in `--sql` and `--file`. The batch is sent through one DB2 runner call after the normal
connection guard probe. JSON output returns one result object per statement.

## Search and Evidence Enrichment

```powershell
node .\cli\zeus.js field-search --profile default --field FIELD_ALPHA --table APP_TABLE --source .\rpg_sources --mode all
node .\cli\zeus.js search-source --source-root .\rpg_sources --search-term "CHAIN(" --max-results 50
Get-ChildItem -Recurse .\rpg_sources | Select-String -Pattern "CHAIN\\("
node .\cli\zeus.js inspect-object --profile default --lib APPLIB --name APP_TABLE_00 --type *FILE --journal
```

## Risk and Test Planning

```powershell
node .\cli\zeus.js impact --field RECORD_ID --program ORDERPGM --source .\rpg_sources --out .\output
node .\cli\zeus.js assess-risk --program ORDERPGM --out .\output
node .\cli\zeus.js generate-test --program ORDERPGM --format markdown --out .\output
node .\cli\zeus.js generate-checklist --program ORDERPGM --type BOTH --impact HIGH --out .\output
```

## Packaging and Review

```powershell
node .\cli\zeus.js bundle --program ORDERPGM --profile default --include-md --include-json
node .\cli\zeus.js serve --source-output-root .\output --host 127.0.0.1 --port 4782
```

## MCP Local-Only Exposure

```powershell
node .\cli\zeus.js mcp serve --verbose
node .\cli\zeus.js mcp serve --verbose --allow-tools zeus.health,zeus.version,zeus.profiles,zeus.doctor,zeus.help,zeus.onboarding,zeus.analyze,zeus.workflow,zeus.bundle,zeus.search-source,zeus.field-search,zeus.resolve-object,zeus.inspect-object,zeus.query-table,zeus.query-sql,zeus.impact,zeus.assess-risk,zeus.generate-test,zeus.generate-checklist,zeus.qa,zeus.validate-rpg-sql,zeus.analyses,zeus.fetch-member,zeus.diff,zeus.copy-to-workspace,zeus.joblog,zeus.docs-generate-catalog,zeus.serve,zeus.test-run
```

## Controlled Write Commands (Explicit Approval Required)

```powershell
node .\cli\zeus.js update --profile default --sql "UPDATE APPDATA.APP_TABLE_00 SET STATUS='Y' WHERE ID=1" --backup --require-backup
node .\cli\zeus.js write-sql --profile default --sql "DELETE FROM APPDATA.APP_TABLE_00 WHERE STATUS='X'" --confirm --backup --require-backup --backup-schema APPBAK
node .\cli\zeus.js write-sql --profile default --sql "INSERT INTO APPDATA.APP_TABLE_00 (ID) VALUES (1); UPDATE APPDATA.APP_TABLE_00 SET STATUS='Y' WHERE ID=1" --confirm
node .\cli\zeus.js insert --profile default --sql "INSERT INTO APPDATA.APP_TABLE_00 (ID) VALUES (1)"
```

Guarded write commands also accept semicolon-separated DML batches. Validation, preflight
row counts, and backup handling run per statement; execution still requires the usual
operator confirmation flags.
