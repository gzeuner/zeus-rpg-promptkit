# Zeus RPG PromptKit

> **Status:** DRAFT – Work In Progress

**Kurzbeschreibung:**  
Zeus RPG PromptKit ist ein evidenzbasiertes Analyse-Toolkit für IBM i‑Landschaften. Es holt RPG‑Quellen von IBM i, normalisiert sie, analysiert Abhängigkeiten, reichert sie mit DB2‑Metadaten an und erzeugt wiederverwendbare Artefakte für Entwickler:innen, Architekt:innen, QA, Modernisierungsteams und KI‑Workflows.  
Es **generiert keinen Business‑Code** und hängt **an keinem bestimmten KI‑Anbieter** – stattdessen liefert es strukturierte, überprüfbare Kontextartefakte.

---

## KI-Prompts auf einen Blick

Für die tägliche IBM i‑Arbeit mit KI-Unterstützung gibt es zwei zentrale Prompt-Dateien mit klar getrennten Rollen:

| Datei                            | Wann verwenden                                       | Zweck                                                |
|---------------------------------|------------------------------------------------------|------------------------------------------------------|
| `docs/ai-session-prompt.md`     | Beim Start einer IBM i-Arbeitssession mit Ticket    | KI als IBM i-Analyseassistent nutzen – Queries, Diagnose, Code-Vorbereitung |
| `.github/copilot-instructions.md` | Wird von GitHub Copilot automatisch geladen        | Hintergrundregeln für Copilot beim Weiterentwickeln von Zeus selbst |

**Wichtig:**

- Für Ticket-Sessions:  
  `docs/ai-session-prompt.md` öffnen, den Codeblock kopieren, in den Chat einfügen und unten das konkrete Ticketziel ergänzen:

  ```text
  [...Inhalt des Code-Blocks...]

  Mein Ziel für diese Session:
  CHANGE-1234: Prüfe ob RECORD_ID 30363 noch einen Staging-Eintrag hat
  und bereinige ihn nach Rücksprache.
  ```

- Die `copilot-instructions.md` muss nie manuell eingefügt werden – Copilot liest sie automatisch, wenn du in diesem Repo arbeitest.

**Sicherheitsrahmen (Kurzfassung):**

- IBM i-Systeme: ausschließlich lesend, keine automatischen Schreiboperationen.
- Änderungen immer lokal im Workspace und als Diff, nie direkt auf IBM i.
- Datenändernde SQL (INSERT/UPDATE/DELETE) zuerst zeigen, dann auf explizite Freigabe warten.

---

## Inhaltsverzeichnis

- [Quickstart](#quickstart)
- [Verfügbare CLI-Befehle](#verfügbare-cli-befehle)
- [Setup & Installation](#setup--installation)
- [Profile & Env-Variablen](#profile--env-variablen)
- [Analyse-Ergebnisse & lokale UI](#analyse-ergebnisse--lokale-ui)
- [Multi-Root-Workspace & KI-Prompts](#multi-root-workspace--ki-prompts)
- [Anwendungsfälle & Workflows](#anwendungsfälle--workflows)
- [Architekturüberblick](#architekturüberblick)
- [Best Practices & Anti-Pattern](#best-practices--anti-pattern)
- [Lizenz](#lizenz)

---

## Quickstart

### A) Schnellstart ohne IBM i-Anbindung (lokale Quellen)

```bash
# 1. Dependencies installieren
npm install

# 2. Lokalen RPG-Quellbaum analysieren – keine Credentials nötig
node cli/zeus.js analyze --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context

# 3. Ergebnisse im Browser ansehen
node cli/zeus.js serve --source-output-root ./output
# → http://localhost:4782
```

**Erste Anlaufstellen im Output:**

- `output/ORDERPGM/report.md`
- `output/ORDERPGM/architecture-report.md`
- `output/ORDERPGM/ai_prompt_documentation.md`

---

### B) Schnellstart mit IBM i-Fetch & Profilen

```bash
# 1. Dependencies installieren
npm install

# 2. Profil anlegen (einmalig)
cp config/profiles.example.json config/local-only/profiles.json
# → config/local-only/profiles.json anpassen (sourceRoot, outputRoot, DB-/Fetch-Angaben)

# 3. Env-Variablen in die Shell-Session laden (immer durch den User)
. .\config\load-env.ps1          # Windows PowerShell
# source ./config/load-env.sh   # macOS / Linux

# 4. Setup prüfen
node cli/zeus.js doctor --profile default

# 5. IBM i-Quellen holen & analysieren
node cli/zeus.js fetch   --profile default-fetch
node cli/zeus.js analyze --profile default       --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context
```

**Ohne IBM i-Anbindung:**  
RPG-Dateien in `rpg_sources/` ablegen, Schritte 3–4 überspringen, direkt mit Schritt 5 starten.

---

## Verfügbare CLI-Befehle

Alle Befehle können entweder mit Node aufgerufen werden:

```bash
node cli/zeus.js <command> [options]
```

oder nach `npm link` auch direkt als:

```bash
zeus <command> [options]
```

### Überblick

```text
doctor        Umgebungs-Check: Env-Vars, Java, Profile
analyze       RPG-Quellen scannen, Entitäten & Abhängigkeiten extrahieren
workflow      Vollständiger Preset-Lauf (fetch → analyze → bundle)
fetch         IBM i-Quellen per SFTP/JT400/FTP herunterladen
analyze       Scanned RPG/CL/DDS, builds canonical model + AI context artefacts
bundle        Analyse-Artefakte als ZIP bündeln
impact        Reverse-Abhängigkeitsanalyse für Programm oder Feld
assess-risk   Klassifiziert Zugriffe nach Risiko (🟢🟡🔴) + UAT-Recommendations
generate-test Generiert Test-Plan + Jest-Templates basierend auf Struktur
generate-checklist Deployment-Checkliste + Timeline basierend auf Änderungen
query-table   DB2-Tabellen-Metadaten abfragen (read-only)
query-sql     Beliebige read-only SQL-Abfrage ausführen (--sql oder --file)
field-search  Feld/Tabelle in Quellen finden (lokal, IBM i, SQL-Xref)
serve         Lokale Browser-UI für generierte Reports starten
diff          Lokales Member mit IBM i-Version vergleichen
```

### Wichtige Spezialfälle

**`doctor --show-resolved`** – zeigt aufgelöste Verbindungsparameter & CURRENT_SERVER-Abgleich:

```bash
node cli/zeus.js doctor --profile sample-ase --show-resolved
# Gibt u.a. aus: db.host, db.user, JDBC-URL, CURRENT_SERVER-Abgleich, productionSystem-Flag
```

**`query-sql --file`** – SQL aus Datei ausführen (inkl. `--`-Kommentar-Header):

```bash
node cli/zeus.js query-sql --profile myprofile --file ./test-scripts/sql/my-query.sql --output table
```

**`field-search`** – beantwortet „Wer greift auf Feld X in Tabelle Y zu?“ in drei Stufen:

```bash
# Stufe 1: Lokal in bereits gefetchten Quellen (schnell)
node cli/zeus.js field-search --profile sample-ase --field FIELD_ALPHA --table APP_TABLE --source ./analysis/zeus-fetch --mode local

# Stufe 2: Remote – alle Member einer Library direkt auf IBM i
node cli/zeus.js field-search --profile sample-ase --field FIELD_ALPHA --table APP_TABLE --source-lib ASE --source-file QRPGLESRC --mode remote

# Alle Stufen kombiniert (lokal + remote + SQL-Abhängigkeiten via QSYS2.SYSDEPEND)
node cli/zeus.js field-search --profile sample-ase --field FIELD_ALPHA --table APP_TABLE --source ./analysis/zeus-fetch --source-lib ASE --mode all
```

Parameter (Auszug):  
`--field <name>` (Pflicht), `--table <name>`, `--source <pfad>`, `--source-lib <lib>`, `--source-file <file>` (Default: `QRPGLESRC`),  
`--mode local|remote|xref|all` (Default: `all`), `--max-results <n>` (Default: `300`), `--verbose`.  
Die Ausgabe kennzeichnet automatisch den Kontext, z. B. `[READS:TABELLE]`, `[WRITES:TABELLE]`.

### Workflow-Presets

Vorkonfigurierte Workflows für typische Reviews:

```bash
node cli/zeus.js workflow --preset onboarding             --source ./rpg_sources --program ORDERPGM
node cli/zeus.js workflow --preset architecture-review    --source ./rpg_sources --program ORDERPGM
node cli/zeus.js workflow --preset security-review        --source ./rpg_sources --program ORDERPGM
node cli/zeus.js workflow --preset modernization-review   --source ./rpg_sources --program ORDERPGM
node cli/zeus.js workflow --preset dependency-risk        --source ./rpg_sources --program ORDERPGM
node cli/zeus.js workflow --preset refactoring-review     --source ./rpg_sources --program ORDERPGM
node cli/zeus.js workflow --preset test-generation-review --source ./rpg_sources --program ORDERPGM
```

---

## Setup & Installation

### Anforderungen

- Node.js 20+
- Java 11+
- optional: `java/lib/jt400.jar` für IBM i / DB2-Workflows
- optional: IBM i SSH/SFTP für `zeus fetch`
- optional: DB2-/JT400-JDBC-Zugriff für Metadaten & Testdaten

### Installation

```bash
npm install
```

Optionale globale CLI-Installation:

```bash
npm link
# Danach:
zeus analyze --source ./rpg --program ORDERPGM
```

Ohne `npm link`:

```bash
node cli/zeus.js analyze --source ./rpg --program ORDERPGM
npm run analyze -- --source ./rpg --program ORDERPGM
```

Tests:

```bash
npm test
npm run test:unit
npm run test:smoke
npm run test:contract
npm run test:corpus
npm run test:benchmark
```

---

## Profile & Env-Variablen

### Grundprinzip

- **Credentials kommen nie in Git.**
- `config/local-only/profiles.json` ist **gitignored** und wird **nie committed**.
- Passwörter nur als Platzhalter wie `${env:ZEUS_DB_PASSWORD}` in `profiles.json`.
- Die echten Werte setzt immer der User über Env-Variablen in der Shell-Session.

### Profile anlegen

```bash
# macOS / Linux
cp config/profiles.example.json config/local-only/profiles.json

# Windows PowerShell
Copy-Item config/profiles.example.json config/local-only/profiles.json
```

Dann `config/local-only/profiles.json` anpassen (Pfade, Profilnamen, DB-/Fetch-Konfiguration).  
Setup prüfen:

```bash
node cli/zeus.js doctor --profile default
```

### Wichtige Env-Variablen

**IBM i Fetch:**

```powershell
$env:ZEUS_FETCH_HOST       = "myibmi.example.com"
$env:ZEUS_FETCH_USER       = "MYUSER"
$env:ZEUS_FETCH_PASSWORD   = "secret"
$env:ZEUS_FETCH_SOURCE_LIB = "SOURCEN"
$env:ZEUS_FETCH_IFS_DIR    = "/home/zeus/rpg"
$env:ZEUS_FETCH_OUT        = "./rpg_sources"
```

**DB2-Metadaten (optional):**

```powershell
$env:ZEUS_DB_HOST           = "myibmi.example.com"
$env:ZEUS_DB_USER           = "MYUSER"
$env:ZEUS_DB_PASSWORD       = "secret"
$env:ZEUS_DB_DEFAULT_SCHEMA = "MYLIB"
```

Typische Variablen (Auszug):

| Variable                 | Zweck                                      |
|--------------------------|--------------------------------------------|
| `ZEUS_SOURCE_ROOT`       | Source-Root für Profile-Platzhalter        |
| `ZEUS_OUTPUT_ROOT`       | Output-Root für Profile-Platzhalter        |
| `ZEUS_FETCH_*`           | Host/User/Pass/Lib/IFS für Fetch           |
| `ZEUS_DB_*`              | DB2-Endpoint & Credentials                 |
| `ZEUS_METADATA_DB_*`     | Optional separater Metadaten-Endpoint      |
| `ZEUS_TESTDATA_DB_*`     | Optional separater Testdaten-Endpoint      |

### Load-Skripte

Statt alles manuell zu setzen:

```powershell
. .\config\load-env.ps1              # Standard
. .\config\load-env.ps1 -Environment project   # system-spezifisch
```

`config/local-only/profiles.json` ist gitignored. Niemals committen.

---

## Analyse-Ergebnisse & lokale UI

Nach `analyze` liegen die Artefakte unter:

```text
output/<PROGRAMM>/
```

Wichtige Dateien:

| Datei                         | Inhalt                                             |
|------------------------------|----------------------------------------------------|
| `report.md`                  | Programm-Zusammenfassung mit Entitätszahlen        |
| `architecture-report.md`     | Abhängigkeiten, Call-Tree, Struktur                |
| `canonical-analysis.json`    | Vollständiges Entitäts- und Evidenzmodell         |
| `ai-knowledge.json`          | Token-optimierter KI-Kontext                       |
| `ai_prompt_documentation.md` | Fertiger KI-Prompt für Erklärung/Doku              |
| `dependency-graph.md`        | Abhängigkeitsgraph (Mermaid)                       |
| `analyze-run-manifest.json`  | Lauf-Protokoll & Artefakt-Übersicht               |

Lokale Browser-UI:

```bash
node cli/zeus.js serve --source-output-root ./output
# → http://localhost:4782
```

Ideal für Reviews ohne direkte Arbeit mit den Rohdateien.

---

## Multi-Root-Workspace & KI-Prompts

Empfohlene VS-Code-Struktur:

- **Ticket-Ordner**  
  Ticketbeschreibung, Anforderungen, Notizen, Arbeitsergebnisse, task-spezifische Dateien.
- **Zeus RPG PromptKit Repo**  
  Profile, Env-Dateien, Zeus CLI, Diagnose- und Analyse-Workflows.

Empfohlener Einstiegssatz für einen KI-Assistenten in dieser Struktur:

> Ich arbeite in einer Multi-Root Workspace mit einem Ticket-Ordner und dem Zeus RPG PromptKit Repo. Lade die Env-Datei und validiere das Setup mit `node cli/zeus.js doctor`, danach arbeiten wir am Ticket: \<kurzes Ticketziel\>.

Die dazugehörigen Prompt-Dateien sind in [KI-Prompts auf einen Blick](#ki-prompts-auf-einen-blick) beschrieben.

---

## Anwendungsfälle & Workflows

Zeus ist ein **Evidence-Preparation Layer**: es erzeugt Artefakte, aus denen Menschen und KI fundiert arbeiten können.

### Typische Szenarien (Kurzüberblick)

- **Legacy-Programm verstehen**  
  `analyze` + `report.md` + `architecture-report.md` + `ai_prompt_documentation.md`
- **Impact-Analyse vor Änderungen**  
  `analyze` + `impact` + `program-call-tree.*` + `impact-analysis.*`
- **Dokumentation & Onboarding**  
  Workflow-Preset `onboarding` oder `documentation`-Mode
- **Modernisierungsvorbereitung**  
  Workflow-Preset `modernization-review`
- **Testfall-Generierung & -Erweiterung**  
  `analyze --mode test-generation` + DB2-Metadaten + Testdaten
- **Security-Review**  
  Workflow-Preset `security-review` oder `analyze --mode security`
- **Browser-Review / Safe-Sharing**  
  `serve` + `bundle --safe-sharing`

Beispiele (verkürzt):

```bash
# A: Programm verstehen
zeus analyze --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context

# B: Impact-Analyse vor Tabellenänderung
zeus analyze --source ./rpg_sources --program ORDERPGM --out ./output
zeus impact  --program ORDERPGM --target ORDERS --out ./output

# C: Modernisierungs-Bundle
zeus workflow --preset modernization-review --source ./rpg_sources --program ORDERPGM --out ./output --bundle-output ./bundles
```

---

## Architekturüberblick

### Node.js CLI

Haupteinstiegspunkt:

- `cli/zeus.js`

Zentrale Module (Auszug):

- `src/collector/sourceCollector.js` – Source-Discovery
- `src/scanner/rpgScanner.js` / `clScanner.js` / `ddsScanner.js` – RPG/CL/DDS-Scanner
- `src/scanner/dependencyScanner.js` – Abhängigkeits-Extraktion
- `src/source/sourceType.js` – Source-Typ-Klassifikation
- `src/context/canonicalAnalysisModel.js` – kanonisches Modell
- `src/context/contextBuilder.js` – Entwickler:innen-konformer Kontext
- `src/dependency/dependencyGraphBuilder.js` – Dependency-Graph
- `src/dependency/crossProgramGraphBuilder.js` – Call-Graph
- `src/dependency/programSourceResolver.js` – Programmmember-Resolution
- `src/report/markdownReport.js` / `architectureReport.js` – Report-Generierung
- `src/prompt/promptBuilder.js` / `promptRegistry.js` – Prompt-Rendering & -Vertrag
- `src/security/secretMasking.js` – Secret-Masking
- `src/viewer/architectureViewerGenerator.js` – interaktive HTML-Ansicht
- `src/impact/impactAnalyzer.js` – Reverse-Impact
- `src/analyze/stageRegistry.js` – Pipeline-Registry

### Java-Helper

Für IBM i- und DB2-spezifische Aufgaben (unter `java/`, vorkompiliert nach `java/bin/`, mit `java/lib/jt400.jar`):

| Java-Klasse                | Verwendet von                          | Zweck                                              |
|----------------------------|----------------------------------------|----------------------------------------------------|
| `IbmiCommandRunner`        | `fetch`                                | CL-Commands via JT400 ausführen                    |
| `IbmiMemberLister`         | `fetch`                                | Source-Member in Library/File auflisten           |
| `IbmiSourceMemberExporter` | `fetch`                                | JDBC-Fallback-Export von Source-Membern           |
| `IbmiIfsDownloader`        | `fetch`                                | IFS-Verzeichnisbaum herunterladen                  |
| `Db2DiagnosticQueryRunner` | `query-sql`, `query-table`, `analyze`  | Read-only DB2-SELECTs                              |
| `Db2MetadataExporter`      | `analyze`                              | Schema-Metadaten (Tabellen/Spalten/Keys/Trigger)   |
| `Db2ExternalObjectResolver`| `analyze`                              | Views, Aliase, externe Objekte auflösen           |
| `Db2TestDataExtractor`     | `analyze`                              | Maskierte Beispiel-Datensätze exportieren          |
| `IbmiSourceSearcher`       | `field-search`                         | Volltextsuche über IBM i Source-Member             |

Aufruf erfolgt über `src/java/javaRuntime.js`:

- verwaltet Classpath (`java/bin:java/lib/jt400.jar`)
- kompiliert `.java` bei Bedarf nach `.class`
- startet Java-Prozesse via `child_process.spawnSync`
- liefert `{ status, stdout, stderr }` zurück

---

## Best Practices & Anti-Pattern

### Best Practices

1. **Provenienz erhalten**  
   `zeus-import-manifest.json` zusammen mit den gefetchten Quellen aufbewahren.
2. **Encoding früh normalisieren**  
   UTF‑8 (CCSID 1208) für IFS-Export verwenden.
3. **Mit den richtigen Artefakten starten**  
   Erst `report.md` / `architecture-report.md` / `ai_prompt_*`, dann bei Bedarf JSON.
4. **DB2 anziehen, wenn Datenverhalten relevant ist**  
   FK, Trigger, Nullability, dynamisches SQL → DB2-Metadaten einbeziehen.
5. **Unaufgelöste Referenzen ernst nehmen**  
   Markieren echte Unsicherheit, nicht nur „Kosmetik“.
6. **KI geerdet halten**  
   KI-Antworten gegen `canonical-analysis.json` / `db2-metadata.json` / Graphen prüfen.
7. **Safe-Sharing nutzen**  
   Für externe Reviews `--safe-sharing` und gebündelte ZIPs verwenden.
8. **Workflow-Presets für Wiederholfälle**  
   Onboarding, Architektur-Review, Modernisierung, Dependency-Risk etc. per Preset fahren.

### Anti-Pattern

Vermeide:

- Roh-Source unbehandelt an KI zu geben
- DB2-Metadaten wegzulassen, wenn Schema-Logik kritisch ist
- Encoding-Mischmasch in einem Source-Tree
- Sample-Testdaten als „Produktionswahrheit“ zu lesen
- Unaufgelöste Referenzen zu ignorieren, „weil der Rest gut aussieht“
- Alle Artefakte blind in ein einziges KI-Prompt zu kippen

---

## Lizenz

Dieses Projekt ist unter der **Apache License 2.0** lizenziert.  
Details siehe `LICENSE`.