# Zeus RPG PromptKit

Evidence-first IBM i RPG, CL, DDS, and DB2 analysis toolkit for humans and AI.

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)
![Java](https://img.shields.io/badge/Java-11+-blue?logo=openjdk&logoColor=white)
![IBM i](https://img.shields.io/badge/Platform-IBM%20i%20%2F%20AS%2F400-1F70C1)
![DB2](https://img.shields.io/badge/DB-DB2-0F62FE)
![License](https://img.shields.io/badge/License-Apache%202.0-green)
![Status](https://img.shields.io/badge/Status-Active%20Development-blueviolet)

![Zeus RPG PromptKit](./images/zeus-rpg-promptkit.png)

## Deutsch

Zeus RPG PromptKit ist ein CLI-zentriertes Node.js-/Java-Toolkit fuer IBM i / AS/400 Teams. Es holt Source Members aus IBM i oder analysiert lokale Quellbestaende, baut ein kanonisches Abhaengigkeitsmodell auf, verknuepft DB2-Evidence und erzeugt nachvollziehbare Artefakte fuer Dokumentation, Architektur, Impact-Analysen, QA und KI-gestuetzte Entwicklungsarbeit.

Diese README konzentriert sich bewusst auf CLI, Analyse-Pipeline und Artefakte. GUI-/Viewer-Themen sind hier absichtlich weggelassen.

### Wichtige Hinweise

- Zeus RPG PromptKit ist kein Generator fuer Business-Code und kein Ersatz fuer fachliche Pruefung.
- Das Projekt liefert Kontext, Evidenz und Struktur. Bewertung, Tests, Freigaben und produktive Entscheidungen bleiben in menschlicher Verantwortung.
- Die bereitgestellten Informationen und Artefakte werden ohne Gewaehr fuer Richtigkeit, Vollstaendigkeit oder Aktualitaet bereitgestellt.
- Zeus RPG PromptKit ist kein offizielles IBM-Produkt und steht in keiner Verbindung zu IBM oder anderen Herstellern oder Unternehmen. Genannte Produktnamen und Marken gehoeren ihren jeweiligen Eigentuemer:innen.

### Was das Projekt leistet

- IBM i Source Fetch ueber `sftp`, `jt400`, `ftp` oder Analyse lokaler Quellverzeichnisse
- Statische Analyse von RPG III/IV, SQLRPGLE, CL/CLLE, DDS, PF/LF, Binder- und Copy-Quellen
- Cross-Program Dependency Mapping, Call Trees und Graph-Artefakte
- DB2-Metadaten, Read-only SQL-Diagnostik und optional reglementierte Testdaten-Extraktion
- Workflow-Presets fuer Onboarding, Architektur-Review, Security, Refactoring, Modernisierung und Testplanung
- Reproduzierbare Outputs, Safe-Sharing-Artefakte und Bundle-Erzeugung fuer Reviews oder KI-Sessions

### Projektueberblick

- `cli/zeus.js`: zentrale CLI mit `doctor`, `fetch`, `analyze`, `workflow`, `impact`, `bundle`, `qa` und DB2-Helfern
- `src/`: Scanner, Analyse-Pipeline, Workflows, Bundling, Safety, DB2-Integration, Reports
- `java/`: Helfer fuer IBM i-/DB2-Zugriff
- `examples/demo-rpg-mini-system/`: synthetische Demo mit lauffaehigem End-to-End-Beispiel
- `docs/`: Tool-Katalog, Quickstarts, Safety-Guides und Workflow-Dokumentation

### Schnellstart mit der Demo

Voraussetzungen:

- Node.js 20+
- `npm install`
- Java 11+ fuer IBM i-/DB2-Funktionen; fuer die lokale Demo ist kein Remote-Zugriff noetig

```bash
git clone https://github.com/gzeuner/zeus-rpg-promptkit.git
cd zeus-rpg-promptkit
npm install
npm run demo:run
npm run demo:prompt
```

Wichtige Demo-Artefakte liegen danach unter `examples/demo-rpg-mini-system/output-baseline/PROGRAM_100/`, zum Beispiel:

- `canonical-analysis.json`
- `analysis-index.json`
- `ai-knowledge.json`
- `report.md`
- `architecture-report.md`
- `dependency-graph.mmd`
- `ai-session-prompt.md`

### Arbeit mit lokalen Quellen

Wenn deine Quellen bereits lokal vorliegen, brauchst du keinen IBM i Fetch-Schritt:

```bash
node cli/zeus.js analyze \
  --source ./rpg_sources \
  --program ORDERPGM \
  --out ./output \
  --optimize-context
```

Fuer einen gefuehrten Preset-Lauf:

```bash
node cli/zeus.js workflow \
  --preset onboarding \
  --source ./rpg_sources \
  --program ORDERPGM \
  --out ./output
```

### Einsatz auf echten IBM i-Systemen

1. Lokale Konfiguration anlegen.
2. Umgebungsvariablen laden.
3. Profil mit `doctor` pruefen.
4. Quellen holen und analysieren.

```bash
cp config/.env.example config/.env.local
cp config/profiles.example.json config/local-only/profiles.json
source ./config/load-env.sh

node cli/zeus.js doctor --profile default-fetch --show-resolved
node cli/zeus.js fetch --profile default-fetch
node cli/zeus.js analyze --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context
```

Wenn du nur DB2-/IBM i-Evidence vertiefen willst, sind vor allem diese Befehle relevant:

```bash
node cli/zeus.js query-table --profile default --table APP_TABLE_00 --schema APPDATA
node cli/zeus.js query-sql --profile default --sql "SELECT * FROM QSYS2.SYSTABLES FETCH FIRST 10 ROWS ONLY"
node cli/zeus.js joblog --profile default --severity ERROR --max-messages 100
node cli/zeus.js inspect-object --profile default --lib APPLIB --name APP_TABLE_00 --type *FILE --journal
```

### Sicherheitsmodell

- Der Standardpfad fuer Analyse und Evidence-Aufbau bleibt in den niedrigen Safety-Levels `S0` bis `S2`: `S0` lokal read-only, `S2` remote read-only, `S1` nur fuer lokale Artefakt-Erzeugung im Workspace bzw. unter `./output`.
- `fetch`, `query-table`, `query-sql`, `joblog` und `inspect-object` lesen nur.
- Kontrollierte Schreibbefehle wie `insert`, `update`, `upsert` und `bridge` existieren, gehoeren aber bewusst nicht in den Schnellstart.

### Tests

```bash
npm test
```

### Weiterfuehrende Dokumentation

- [Tool Catalog](docs/tool-catalog.md)
- [CLI Examples](docs/cli/examples.md)
- [AI Session Prompt Guide](docs/ai/session-prompt.md)
- [Investigation Workflows](docs/workflows/investigation-workflows.md)
- [Safety Best Practices](docs/safety/best-practice-guide.md)
- [Documentation Hub](docs/index.md)

## English

Zeus RPG PromptKit is a CLI-first Node.js and Java toolkit for IBM i / AS/400 teams. It can fetch source members from IBM i or analyze local source trees, build a canonical dependency model, link DB2 evidence, and emit reviewable artifacts for documentation, architecture work, impact analysis, QA, and AI-assisted engineering.

This README intentionally focuses on the CLI, the analysis pipeline, and the generated artifacts. GUI/viewer topics are intentionally left out.

### Important notices

- Zeus RPG PromptKit is not a business-code generator and not a substitute for domain review.
- The project provides context, evidence, and structure. Evaluation, testing, approvals, and production decisions remain the responsibility of human operators.
- The provided information and generated artifacts are supplied without warranty regarding accuracy, completeness, or currency.
- Zeus RPG PromptKit is not an official IBM product and is not affiliated with IBM or any other vendor or company. All mentioned product names and trademarks belong to their respective owners.

### What the project covers

- IBM i source ingest via `sftp`, `jt400`, or `ftp`, plus local-source analysis
- Static analysis for RPG III/IV, SQLRPGLE, CL/CLLE, DDS, PF/LF, binder, and copy sources
- Cross-program dependency mapping, call trees, and graph artifacts
- DB2 metadata, read-only SQL diagnostics, and optional governed test-data extraction
- Workflow presets for onboarding, architecture review, security, refactoring, modernization, and test planning
- Reproducible output, safe-sharing artifacts, and review bundles for human or AI workflows

### Project snapshot

- `cli/zeus.js`: main CLI with `doctor`, `fetch`, `analyze`, `workflow`, `impact`, `bundle`, `qa`, and DB2 helpers
- `src/`: scanners, analysis pipeline, workflows, bundling, safety, DB2 integration, reports
- `java/`: helpers for IBM i and DB2 access
- `examples/demo-rpg-mini-system/`: synthetic end-to-end demo
- `docs/`: authoritative tool catalog, quickstarts, safety guidance, and workflow docs

### Quick start with the demo

Requirements:

- Node.js 20+
- `npm install`
- Java 11+ for IBM i / DB2 features; the local demo does not need remote access

```bash
git clone https://github.com/gzeuner/zeus-rpg-promptkit.git
cd zeus-rpg-promptkit
npm install
npm run demo:run
npm run demo:prompt
```

Key demo outputs are written to `examples/demo-rpg-mini-system/output-baseline/PROGRAM_100/`, including:

- `canonical-analysis.json`
- `analysis-index.json`
- `ai-knowledge.json`
- `report.md`
- `architecture-report.md`
- `dependency-graph.mmd`
- `ai-session-prompt.md`

### Working with local sources

If your sources are already on disk, you can skip IBM i fetching:

```bash
node cli/zeus.js analyze \
  --source ./rpg_sources \
  --program ORDERPGM \
  --out ./output \
  --optimize-context
```

For a preset-driven run:

```bash
node cli/zeus.js workflow \
  --preset onboarding \
  --source ./rpg_sources \
  --program ORDERPGM \
  --out ./output
```

### Running against real IBM i systems

1. Create local config files.
2. Load environment variables.
3. Validate the profile with `doctor`.
4. Fetch and analyze sources.

```bash
cp config/.env.example config/.env.local
cp config/profiles.example.json config/local-only/profiles.json
source ./config/load-env.sh

node cli/zeus.js doctor --profile default-fetch --show-resolved
node cli/zeus.js fetch --profile default-fetch
node cli/zeus.js analyze --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context
```

Useful commands for evidence deepening:

```bash
node cli/zeus.js query-table --profile default --table APP_TABLE_00 --schema APPDATA
node cli/zeus.js query-sql --profile default --sql "SELECT * FROM QSYS2.SYSTABLES FETCH FIRST 10 ROWS ONLY"
node cli/zeus.js joblog --profile default --severity ERROR --max-messages 100
node cli/zeus.js inspect-object --profile default --lib APPLIB --name APP_TABLE_00 --type *FILE --journal
```

### Safety model

- The primary analysis path stays in the low safety levels `S0` to `S2`: `S0` is local read-only, `S2` is remote read-only, and `S1` is limited to local artifact generation in the workspace or under `./output`.
- `fetch`, `query-table`, `query-sql`, `joblog`, and `inspect-object` are read-only by design.
- Controlled write commands such as `insert`, `update`, `upsert`, and `bridge` exist, but are intentionally excluded from the quick start.

### Tests

```bash
npm test
```

### Documentation

- [Tool Catalog](docs/tool-catalog.md)
- [CLI Examples](docs/cli/examples.md)
- [AI Session Prompt Guide](docs/ai/session-prompt.md)
- [Investigation Workflows](docs/workflows/investigation-workflows.md)
- [Safety Best Practices](docs/safety/best-practice-guide.md)
- [Documentation Hub](docs/index.md)

## License

Apache License 2.0. See [LICENSE](LICENSE).
