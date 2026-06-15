---
Title: CLI Examples
Description: CLI-Referenz- und Praxisdokumentation fuer reproduzierbare Zeus-Befehlsablaeufe.
Last Updated: 2026-06-15
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
node .\cli\zeus.js analyze --source .\rpg_sources --program ORDERPGM --out .\output --optimize-context
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
node .\cli\zeus.js joblog --profile default --severity ERROR --max-messages 100
```

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
node .\cli\zeus.js mcp serve --verbose --allow-tools zeus.health,zeus.query-table,zeus.query-sql
```

## Controlled Write Commands (Explicit Approval Required)

```powershell
node .\cli\zeus.js update --profile default --sql "UPDATE APPDATA.APP_TABLE_00 SET STATUS='Y' WHERE ID=1" --backup --require-backup
node .\cli\zeus.js write-sql --profile default --sql "DELETE FROM APPDATA.APP_TABLE_00 WHERE STATUS='X'" --confirm --backup --require-backup --backup-schema APPBAK
node .\cli\zeus.js insert --profile default --sql "INSERT INTO APPDATA.APP_TABLE_00 (ID) VALUES (1)"
```
