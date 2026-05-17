---
Title: Zeus RPG PromptKit Tool Catalog
Description: Verbindlicher, sicherheitsklassifizierter Katalog aller CLI-Befehle und Workflow-Presets fuer Menschen und KI-Assistenten.
Last Updated: 2026-05-17
---

# Zeus RPG PromptKit Tool Catalog

Dies ist die verbindliche Referenz fuer Zeus-Befehle. Alle KI-Assistenten behandeln diese Datei als Single Source of Truth fuer Zweck, Risiko und Nutzung.

Related:
- [`index.md`](index.md)
- [`ai/session-prompt.md`](ai/session-prompt.md)
- [`cli/reference.md`](cli/reference.md)

## Safety Levels

| Level | Meaning | Typical Action |
|---|---|---|
| `S0` | Local read-only | Lokale Artefakte lesen, vergleichen, validieren |
| `S1` | Local write | Nur lokale Workspace-Artefakte erzeugen/aktualisieren |
| `S2` | Remote read-only | IBM i/DB2 nur lesend abfragen |
| `S3` | Controlled write | Datenmutationen nur nach expliziter Freigabe |
| `S4` | High-risk / operator-gated | Bridge/apply/compile-Klasse, strikt manuell gesteuert |

## Mandatory AI Execution Rules

1. Standard ist `S0`/`S2` (read-first, evidence-first).
2. Vor `S3` oder `S4` immer explizite Freigabe einholen.
3. Riskante Schritte nie implizit ausfuehren.
4. Vor Risiken immer exakte Commandline zeigen.
5. Erst lokal vorbereiten, dann Diff/Report zur Entscheidung vorlegen.

## CLI Command Catalog

| Command | Safety | Scope | Purpose | Example |
|---|---|---|---|---|
| `doctor` | `S0` | Local | Runtime-, Profil- und Env-Vertrag validieren | `node cli/zeus.js doctor --profile default --show-resolved` |
| `fetch` | `S2` | IBM i read | Source-Member/IFS-Inhalte lokal importieren | `node cli/zeus.js fetch --profile default-fetch` |
| `analyze` | `S1` | Local | RPG/CL/DDS analysieren und Evidence-Artefakte erzeugen | `node cli/zeus.js analyze --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context` |
| `workflow` | `S1` | Local | Legacy Preset-Flow (`analyze + bundle`) ausfuehren | `node cli/zeus.js workflow --preset architecture-review --source ./rpg_sources --program ORDERPGM --out ./output` |
| `workflow run` | `S1` | Local | Profil-/Runtime-definierte Workflow-Engine ausfuehren | `node cli/zeus.js workflow run --profile default --preset onboarding --out ./output` |
| `bundle` | `S1` | Local | Analyseartefakte fuer Review/Sharing paketieren | `node cli/zeus.js bundle --program ORDERPGM --source-output-root ./output --include-md --include-json` |
| `impact` | `S1` | Local | Reverse-Impact fuer Target/Feld erzeugen | `node cli/zeus.js impact --field RECORD_ID --program ORDERPGM --source ./rpg_sources --out ./output` |
| `assess-risk` | `S1` | Local | Risiko-orientierte Programmzusammenfassung erzeugen | `node cli/zeus.js assess-risk --program ORDERPGM --out ./output` |
| `generate-test` | `S1` | Local | Testplan-/Template-Artefakte erzeugen | `node cli/zeus.js generate-test --program ORDERPGM --format markdown --out ./output` |
| `generate-checklist` | `S1` | Local | Deployment-/Change-Checkliste erzeugen | `node cli/zeus.js generate-checklist --program ORDERPGM --type BOTH --impact HIGH --out ./output` |
| `query-table` | `S2` | DB2 read | DB2-Tabellenmetadaten lesen | `node cli/zeus.js query-table --profile default --table APP_TABLE_00 --schema APPDATA` |
| `query-sql` | `S2` | DB2 read | Read-only SQL (`SELECT`/`WITH`) ausfuehren | `node cli/zeus.js query-sql --profile default --sql "SELECT * FROM QSYS2.SYSTABLES FETCH FIRST 10 ROWS ONLY"` |
| `joblog` | `S2` | IBM i read | IBM i Joblog-Meldungen auswerten | `node cli/zeus.js joblog --profile default --severity ERROR --max-messages 100` |
| `field-search` | `S0/S2` | Local + IBM i read | Feld-/Tabellenverwendung lokal und/oder remote suchen | `node cli/zeus.js field-search --profile default --field FIELD_ALPHA --table APP_TABLE --source ./rpg_sources --mode all` |
| `search-source` | `S0` | Local | Lokalen Source-Baum nach Begriff/Member/Tabelle durchsuchen | `node cli/zeus.js search-source --source-root ./rpg_sources --search-term "CHAIN(" --max-results 50` |
| `copy-to-workspace` | `S1` | Local | Gefetchte Member in Arbeitsbereich uebernehmen | `node cli/zeus.js copy-to-workspace --profile default --members ORDERPGM,INVOICEPGM` |
| `diff` | `S2` | IBM i read + local | Lokalen Member gegen IBM-i-Stand vergleichen | `node cli/zeus.js diff --profile default --member ORDERPGM` |
| `serve` | `S0` | Local | Lokale Viewer-/API-Shell starten | `node cli/zeus.js serve --source-output-root ./output --host 127.0.0.1 --port 4782` |
| `qa` | `S1` | Local | QA-Validierungen als `jira`/`markdown`/`json` rendern | `node cli/zeus.js qa --input ./output/ORDERPGM --format markdown --strict STRICT` |
| `inspect-object` | `S2` | IBM i read | Objektmetadaten/Journaling lesen | `node cli/zeus.js inspect-object --profile default --lib APPLIB --name APP_TABLE_00 --type *FILE --journal` |
| `test-run` | `S2/S1` | DB2 read + local | Test-Snapshots und Rollback-SQL vorbereiten | `node cli/zeus.js test-run start --profile default --program ORDERPGM --table APPLIB.APP_TABLE_00 --key ID=1` |
| `upsert` | `S3` | DB2 write | DML-Wrapper fuer `INSERT/UPDATE/DELETE/MERGE` (freigabepflichtig) | `node cli/zeus.js upsert --profile default --sql "UPDATE APPDATA.APP_TABLE_00 SET STATUS='X' WHERE ID=1"` |
| `upsert-sql` | `S3` | DB2 write | Rueckwaertskompatibler Alias fuer Upsert-Flow | `node cli/zeus.js upsert-sql --profile default --sql "INSERT INTO APPDATA.APP_TABLE_00 (ID) VALUES (1)"` |
| `insert` | `S3` | DB2 write | Strict insert-only DML-Befehl | `node cli/zeus.js insert --profile default --sql "INSERT INTO APPDATA.APP_TABLE_00 (ID) VALUES (1)"` |
| `update` | `S3` | DB2 write | Strict update-only DML-Befehl | `node cli/zeus.js update --profile default --sql "UPDATE APPDATA.APP_TABLE_00 SET STATUS='Y' WHERE ID=1"` |
| `bridge` | `S4` | Operator-gated | Bridge-Plan/Staging/Apply/Compile/Report (nie implizit) | `node cli/zeus.js bridge plan --profile default --help` |
| `pui-edit` | `S1` | Local | Strukturierte lokale UI-Edit-Operationen auf Display-Artefakten | `node cli/zeus.js pui-edit --file ./display/DSPFILE.MBR --action plan --changes-file ./changes.json` |
| `docs:generate-catalog` | `S1` | Local | Generiert den Tool-Katalog aus CLI-/Preset-Metadaten (Stub, geplant) | `node cli/zeus.js docs:generate-catalog --output docs/tool-catalog.md` |

## Workflow Presets (Legacy `workflow --preset`)

| Preset | Analyze Mode | Goal |
|---|---|---|
| `onboarding` | `documentation` | Kompaktes Orientierungspaket fuer neue Engineers |
| `architecture-review` | `architecture` | Struktur-/Abhaengigkeitsfokus fuer Architektur-Review |
| `security-review` | `security` | Sicherheitsorientiertes Evidence-Bundle |
| `modernization-review` | `modernization` | Readiness- und Seams-Analyse fuer Modernisierung |
| `dependency-risk` | `defect-analysis` | Blast-Radius- und Dependency-Risikoanalyse |
| `refactoring-review` | `refactoring` | Planbares, kleines Refactoring-Slice vorbereiten |
| `test-generation-review` | `test-generation` | Szenario-/Fixture-orientierte Testvorbereitung |

## Recommended AI Operating Sequence

1. `doctor` ausfuehren und Profil-/Env-Vertrag bestaetigen.
2. Optional `fetch` (nur wenn Source-Refresh benoetigt und freigegeben).
3. `analyze` oder `workflow --preset ...` fuer initiales Evidence-Paket.
4. Bei Vertiefung: `query-table`, `query-sql`, `joblog`, `field-search`, `search-source`, `inspect-object`.
5. Bei Entscheidungsunterstuetzung: `impact`, `assess-risk`, `generate-test`, `generate-checklist`, `qa`.
6. Fuer Review/Sharing: `bundle` und/oder `serve`.
7. `S3`-Befehle (`upsert`, `insert`, `update`, `upsert-sql`) nur nach expliziter Freigabe.
8. `bridge` nur in operator-gesteuerten Prozessen mit dokumentierter Freigabe.

## How To Keep This File Up To Date

- Kurzfristig: Bei neuen Commands `cli/zeus.js` und diese Tabelle im gleichen PR aktualisieren.
- Mittelfristig: `zeus docs:generate-catalog` nutzen (siehe [`internal/generate-tool-catalog-proposal.md`](internal/generate-tool-catalog-proposal.md)).
- Governance: Bei jeder Aenderung Safety-Level (`S0`-`S4`) und Beispielcommand pruefen.
