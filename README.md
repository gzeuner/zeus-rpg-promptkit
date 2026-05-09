# Zeus RPG PromptKit

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)
![Java](https://img.shields.io/badge/Java-11%2B-blue?logo=openjdk&logoColor=white)
![IBM i](https://img.shields.io/badge/Platform-IBM%20i%20%2F%20AS%2F400-1F70C1)
![DB2](https://img.shields.io/badge/DB-DB2-0F62FE)
![License](https://img.shields.io/badge/License-Apache%202.0-green)
![Status](https://img.shields.io/badge/Status-draft%20%2F%20work%20in%20progress-lightgrey)
![Scope](https://img.shields.io/badge/Scope-evidence--first%20analysis-6A1B9A)

![Zeus RPG PromptKit](./images/zeus-rpg-promptkit.png)

> Status: Draft / Work in Progress  
> Evidence-first toolkit for IBM i RPG analysis, modernization preparation and AI-assisted development workflows.

**Tags:** `IBM i`, `AS/400`, `RPG`, `CL`, `DDS`, `DB2`, `Static Analysis`, `Impact Analysis`, `AI Context`, `Modernization`

---

## Deutsch

### Was ist Zeus RPG PromptKit?

**Zeus RPG PromptKit** ist ein Analyse- und Kontext-Toolkit für IBM i / AS/400-Landschaften.

Es hilft dabei, RPG-, CL- und DDS-Quellen strukturiert auszuwerten, Abhängigkeiten sichtbar zu machen, DB2-Metadaten einzubeziehen und daraus nachvollziehbare Artefakte für Menschen und KI-Assistenten zu erzeugen.

Zeus ist bewusst kein Code-Generator für Business-Logik. Das Projekt liefert einen **Evidence Preparation Layer**: also geprüften, wiederverwendbaren Kontext, der Entwickler:innen, Architekt:innen, QA, Modernisierungsteams und KI-Workflows unterstützt.

Kurz gesagt:

- Quellen holen
- Quellen normalisieren
- Programme, Dateien, Felder und Abhängigkeiten analysieren
- DB2-Metadaten optional ergänzen
- Reports, Graphen und KI-Kontext erzeugen
- Ergebnisse lokal prüfen, teilen oder in Tickets weiterverwenden

Zeus hängt an keinem bestimmten KI-Anbieter. Die erzeugten Artefakte können mit GitHub Copilot, ChatGPT, Claude, lokalen Modellen oder klassischen Reviews verwendet werden.

---

### Wofür ist das Projekt gedacht?

Typische Einsatzbereiche:

- Legacy-RPG-Programme schneller verstehen
- Impact-Analysen vor Änderungen durchführen
- Abhängigkeiten zwischen Programmen, Dateien und Tabellen sichtbar machen
- KI-Assistenten mit sauberem, überprüfbarem Kontext versorgen
- Modernisierungsvorhaben vorbereiten
- technische Dokumentation und Onboarding erleichtern
- Testideen, Deployment-Checklisten und Review-Artefakte erzeugen
- IBM i-Analysen lokal und reproduzierbar durchführen

Zeus ist besonders hilfreich, wenn eine KI nicht einfach „auf gut Glück“ über alte RPG-Quellen reden soll, sondern nachvollziehbare Belege braucht.

---

### Was Zeus nicht macht

Zeus ersetzt keine fachliche Prüfung und keinen verantwortlichen Entwicklungsprozess.

Zeus:

- schreibt keinen Business-Code automatisch auf IBM i
- führt keine ungeprüften Änderungen auf produktiven Systemen aus
- ersetzt kein Review durch Entwickler:innen
- garantiert keine vollständige Analyse bei unvollständigen Quellen
- ist kein offizielles IBM-Produkt
- ist nicht mit IBM verbunden, gesponsert oder zertifiziert

Alle Änderungen, die aus Zeus-Ergebnissen abgeleitet werden, müssen durch Menschen bewertet, getestet und freigegeben werden.

---

### Sicherheitsrahmen

Der sichere Grundsatz lautet:

> IBM i-Systeme werden nur gelesen. Änderungen entstehen lokal im Workspace und werden als Diff geprüft.

Praktisch bedeutet das:

- Fetch-, Query- und Analysefunktionen sind auf lesende Workflows ausgelegt.
- Credentials gehören nie ins Repository.
- Profile mit echten Verbindungsdaten gehören nach `config/local-only/`.
- Datenändernde SQL-Statements müssen manuell geprüft und explizit freigegeben werden.
- KI-Assistenten sollen Vorschläge machen, aber nicht eigenmächtig produktive Systeme verändern.
- Generierte Artefakte können sensible Fachlogik enthalten und sollten bewusst geteilt werden.

Für externe Reviews kann `--safe-sharing` genutzt werden, um Artefakte besser teilbar zu machen.

---

## Quickstart

### Variante A: Lokale Analyse ohne IBM i-Zugang

Diese Variante eignet sich für den Einstieg, für Tests oder für bereits lokal vorhandene RPG-Quellen.

```bash
# 1. Dependencies installieren
npm install

# 2. Lokalen RPG-Quellbaum analysieren
node cli/zeus.js analyze --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context

# 3. Ergebnisse lokal im Browser ansehen
node cli/zeus.js serve --source-output-root ./output
```

Danach ist die lokale UI erreichbar unter:

```text
http://localhost:4782
```

Wichtige Ergebnisdateien:

```text
output/ORDERPGM/report.md
output/ORDERPGM/architecture-report.md
output/ORDERPGM/ai_prompt_documentation.md
output/ORDERPGM/canonical-analysis.json
```

---

### Variante B: IBM i-Fetch mit Profilen

Diese Variante nutzt Profile und Umgebungsvariablen, um Quellen von IBM i zu holen und danach lokal zu analysieren.

```bash
# 1. Dependencies installieren
npm install

# 2. Lokales Profil anlegen
cp config/profiles.example.json config/local-only/profiles.json

# 3. Profil anpassen
# config/local-only/profiles.json bearbeiten

# 4. Env-Variablen laden
source ./config/load-env.sh
# oder unter Windows PowerShell:
# . .\config\load-env.ps1

# 5. Setup prüfen
node cli/zeus.js doctor --profile default

# 6. Quellen holen
node cli/zeus.js fetch --profile default-fetch

# 7. Quellen analysieren
node cli/zeus.js analyze --profile default --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context
```

Ohne IBM i-Anbindung kannst du RPG-Dateien einfach in `rpg_sources/` ablegen und direkt mit `analyze` starten.

---

## Installation

### Voraussetzungen

- Node.js 20 oder neuer
- Java 11 oder neuer
- optional: IBM i SSH/SFTP-Zugang für `fetch`
- optional: DB2-/JT400-Zugriff für Metadaten, Diagnoseabfragen und Testdaten
- optional: `java/lib/jt400.jar`, wenn die Java-Helfer direkt gegen IBM i / DB2 arbeiten sollen

### Lokale Installation

```bash
npm install
```

### CLI direkt nutzen

```bash
node cli/zeus.js <command> [options]
```

### CLI global im lokalen System verlinken

```bash
npm link
zeus <command> [options]
```

---

## CLI-Befehle

| Befehl | Zweck |
|---|---|
| `doctor` | prüft Umgebung, Java, Profile und relevante Env-Variablen |
| `fetch` | lädt IBM i-Quellen per SFTP, JT400 oder FTP-Fallback |
| `analyze` | scannt RPG/CL/DDS-Quellen und erzeugt Analyseartefakte |
| `workflow` | führt vordefinierte Presets aus, z. B. Fetch → Analyze → Bundle |
| `bundle` | packt Analyseartefakte als ZIP |
| `impact` | erstellt Reverse-Impact-Analysen |
| `assess-risk` | bewertet Zugriffe und Änderungen nach Risiko |
| `generate-test` | erzeugt Testpläne und Jest-Templates |
| `generate-checklist` | erzeugt Deployment-Checklisten |
| `query-table` | liest DB2-Tabellenmetadaten |
| `query-sql` | führt read-only SQL aus |
| `field-search` | sucht Feld-/Tabellenzugriffe lokal, remote oder per SQL-Xref |
| `serve` | startet die lokale Browser-UI |
| `diff` | vergleicht lokales Member mit IBM i-Version |

Beispiel:

```bash
node cli/zeus.js doctor --profile default
node cli/zeus.js analyze --source ./rpg_sources --program ORDERPGM --out ./output
node cli/zeus.js serve --source-output-root ./output
```

---

## Workflow-Presets

Für wiederkehrende Aufgaben gibt es Presets:

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

## Profile und Umgebungsvariablen

### Grundprinzip

Credentials gehören nicht ins Repository.

- `config/local-only/profiles.json` ist für lokale Profile gedacht.
- Diese Datei sollte per `.gitignore` ausgeschlossen bleiben.
- Passwörter und Tokens werden über Env-Variablen gesetzt.
- Profile dürfen Platzhalter wie `${env:ZEUS_DB_PASSWORD}` enthalten.
- Die echten Werte lädt immer der User in der Shell-Session.

### Beispiel: Profil anlegen

```bash
cp config/profiles.example.json config/local-only/profiles.json
```

Windows PowerShell:

```powershell
Copy-Item config/profiles.example.json config/local-only/profiles.json
```

Danach:

```bash
node cli/zeus.js doctor --profile default
```

### Typische Env-Variablen

IBM i Fetch:

```powershell
$env:ZEUS_FETCH_HOST       = "myibmi.example.com"
$env:ZEUS_FETCH_USER       = "MYUSER"
$env:ZEUS_FETCH_PASSWORD   = "secret"
$env:ZEUS_FETCH_SOURCE_LIB = "SOURCEN"
$env:ZEUS_FETCH_IFS_DIR    = "/home/zeus/rpg"
$env:ZEUS_FETCH_OUT        = "./rpg_sources"
```

DB2-Metadaten:

```powershell
$env:ZEUS_DB_HOST           = "myibmi.example.com"
$env:ZEUS_DB_USER           = "MYUSER"
$env:ZEUS_DB_PASSWORD       = "secret"
$env:ZEUS_DB_DEFAULT_SCHEMA = "MYLIB"
```

Weitere häufige Variablen:

| Variable | Zweck |
|---|---|
| `ZEUS_SOURCE_ROOT` | Source-Root für Profil-Platzhalter |
| `ZEUS_OUTPUT_ROOT` | Output-Root für Analyseartefakte |
| `ZEUS_FETCH_*` | IBM i Fetch-Konfiguration |
| `ZEUS_DB_*` | DB2-Verbindung |
| `ZEUS_METADATA_DB_*` | optional separater DB2-Endpunkt für Metadaten |
| `ZEUS_TESTDATA_DB_*` | optional separater DB2-Endpunkt für Testdaten |

---

## KI-Prompts und Copilot

Für KI-gestützte IBM i-Arbeit sind zwei Prompt-Dateien wichtig:

| Datei | Wann verwenden | Zweck |
|---|---|---|
| `docs/ai-session-prompt.md` | beim Start einer konkreten Ticket-Session | macht die KI zum IBM i-Analyseassistenten |
| `.github/copilot-instructions.md` | automatisch durch GitHub Copilot im Repo | Regeln für die Weiterentwicklung von Zeus selbst |

Typischer Einstieg für eine Ticket-Session:

```text
Ich arbeite in einer Multi-Root-Workspace mit einem Ticket-Ordner und dem Zeus RPG PromptKit Repo.
Lade die Env-Datei, validiere das Setup mit `node cli/zeus.js doctor` und arbeite danach am Ticket:

CHANGE-1234: Prüfe, ob RECORD_ID 30363 noch einen Staging-Eintrag hat.
```

Die KI soll dabei immer evidenzbasiert arbeiten:

- erst lesen
- dann analysieren
- dann Vorschläge machen
- Änderungen nur lokal vorbereiten
- riskante SQL- oder Systemaktionen vorher explizit zeigen

---

## Analyseartefakte

Nach einem `analyze`-Lauf liegen die Ergebnisse unter:

```text
output/<PROGRAMM>/
```

Wichtige Dateien:

| Datei | Inhalt |
|---|---|
| `report.md` | Programm-Zusammenfassung |
| `architecture-report.md` | Struktur, Call-Tree, Abhängigkeiten |
| `canonical-analysis.json` | vollständiges Entitäts- und Evidenzmodell |
| `ai-knowledge.json` | token-optimierter KI-Kontext |
| `ai_prompt_documentation.md` | fertiger Prompt für Erklärung und Dokumentation |
| `dependency-graph.md` | Mermaid-Abhängigkeitsgraph |
| `analyze-run-manifest.json` | Laufprotokoll und Artefaktübersicht |

Lokale UI starten:

```bash
node cli/zeus.js serve --source-output-root ./output
```

---

## Architekturüberblick

### Node.js CLI

Haupteinstiegspunkt:

```text
cli/zeus.js
```

Zentrale Bereiche:

| Bereich | Aufgabe |
|---|---|
| `src/collector/` | Source Discovery |
| `src/scanner/` | RPG-, CL-, DDS- und Dependency-Scanner |
| `src/context/` | kanonisches Analysemodell und KI-Kontext |
| `src/dependency/` | Dependency- und Call-Graphen |
| `src/report/` | Markdown- und Architekturberichte |
| `src/prompt/` | Prompt-Rendering und Prompt-Verträge |
| `src/security/` | Secret Masking |
| `src/viewer/` | lokale Browser-Ansicht |
| `src/impact/` | Reverse-Impact-Analysen |
| `src/analyze/` | Analysepipeline und Stage Registry |
| `src/java/` | Java Runtime Bridge |

### Java-Helfer

Für IBM i- und DB2-nahe Aufgaben gibt es Java-Helfer unter `java/`.

Typische Klassen:

| Klasse | Zweck |
|---|---|
| `IbmiCommandRunner` | CL-Commands via JT400 ausführen |
| `IbmiMemberLister` | Source-Member in Library/File auflisten |
| `IbmiSourceMemberExporter` | Source-Member exportieren |
| `IbmiIfsDownloader` | IFS-Verzeichnisbaum herunterladen |
| `Db2DiagnosticQueryRunner` | read-only DB2-SELECTs ausführen |
| `Db2MetadataExporter` | Tabellen, Spalten, Keys und Trigger exportieren |
| `Db2ExternalObjectResolver` | Views, Aliase und externe Objekte auflösen |
| `Db2TestDataExtractor` | maskierte Beispiel-Datensätze exportieren |
| `IbmiSourceSearcher` | Source-Member auf IBM i durchsuchen |

---

## Tests

```bash
npm test
npm run test:unit
npm run test:smoke
npm run test:contract
npm run test:corpus
npm run test:benchmark
```

Die Tests decken unter anderem Scanner, Analyseverträge, Runtime-Konfiguration, Profile, Secret Masking, lokale UI und VS-Code-Extension-Verträge ab.

---

## Best Practices

- Quellen und Analyseartefakte versioniert oder nachvollziehbar ablegen.
- `zeus-import-manifest.json` zusammen mit gefetchten Quellen aufbewahren.
- Encoding früh normalisieren, idealerweise UTF-8.
- Erst `report.md` und `architecture-report.md` lesen, dann JSON-Artefakte vertiefen.
- DB2-Metadaten einbeziehen, wenn Tabellenlogik, Constraints, Trigger oder dynamisches SQL relevant sind.
- Unaufgelöste Referenzen nicht ignorieren.
- KI-Antworten immer gegen `canonical-analysis.json`, Reports und DB2-Metadaten prüfen.
- Für externe Weitergabe `--safe-sharing` nutzen.
- Credentials niemals in Prompts, Issues, Artefakte oder ZIPs übernehmen.

---

## Anti-Pattern

Bitte vermeiden:

- komplette Rohquellen unstrukturiert in KI-Chats kippen
- DB2-Metadaten weglassen, obwohl Datenlogik kritisch ist
- Encoding-Mischmasch im Source-Tree ignorieren
- Beispiel-Testdaten als Produktionswahrheit interpretieren
- unaufgelöste Referenzen „wegdenken“
- generierte KI-Antworten ohne Review übernehmen
- produktive IBM i-Systeme durch KI direkt ändern lassen

---

## Lizenz

Dieses Projekt ist unter der **Apache License 2.0** lizenziert.

Siehe:

```text
LICENSE
```

Die Apache License 2.0 ist eine permissive Open-Source-Lizenz. Sie erlaubt Nutzung, Änderung und Weiterverteilung, enthält aber Bedingungen zu Lizenzhinweisen, Copyright-Hinweisen und ggf. NOTICE-Dateien. Außerdem enthält sie eine ausdrückliche Patentlizenz.

### Dependency-Hinweis

Die npm-Abhängigkeiten dieses Projekts sind nach aktuellem Stand permissiv lizenziert, unter anderem MIT, ISC, BSD-3-Clause, Apache-2.0 oder dual lizenziert als Apache-2.0/MIT.

Falls `jt400.jar` / JTOpen mit dem Projekt ausgeliefert wird, sollte dessen Lizenz separat dokumentiert werden. JTOpen / IBM Toolbox for Java steht nach IBM-Angaben unter der IBM Public License. Wenn das JAR nur lokal vom User bereitgestellt wird und nicht Bestandteil des Repositories ist, reicht in der README ein klarer Hinweis auf die externe Komponente.

Empfehlung:

- `LICENSE` mit vollständigem Apache-2.0-Text im Repo behalten.
- optional `NOTICE` anlegen, wenn eigene oder fremde Hinweise aufgenommen werden müssen.
- Dependency-Lizenzen regelmäßig mit einem License-Checker prüfen.
- Bei Distribution von Drittanbieter-JARs deren Lizenztexte beilegen.

Dies ist keine Rechtsberatung, sondern eine technische Einschätzung zur Open-Source-Compliance.

---

## Marken- und Herstellerhinweis

IBM, IBM i, AS/400, DB2, JTOpen, JT400 und weitere in diesem Projekt genannte Produktnamen können Marken oder eingetragene Marken ihrer jeweiligen Eigentümer sein.

Dieses Projekt ist ein unabhängiges Open-Source-Projekt und steht in keiner Verbindung zu IBM oder anderen Herstellern. Es wird weder von ihnen unterstützt, gesponsert, empfohlen noch zertifiziert.

Alle Markenrechte liegen bei ihren jeweiligen Eigentümern.

---

## English

### What is Zeus RPG PromptKit?

**Zeus RPG PromptKit** is an analysis and context preparation toolkit for IBM i / AS/400 environments.

It helps collect, normalize and analyze RPG, CL and DDS sources, extract dependencies, enrich the result with DB2 metadata and produce reusable artifacts for developers, architects, QA teams, modernization projects and AI-assisted workflows.

Zeus is not a business-code generator. It is an **Evidence Preparation Layer**: it creates structured, reviewable and reusable context so humans and AI assistants can work from facts instead of guesswork.

In short:

- fetch sources
- normalize sources
- analyze programs, files, fields and dependencies
- optionally enrich analysis with DB2 metadata
- generate reports, graphs and AI context
- review results locally, share them safely or attach them to tickets

Zeus is not tied to a specific AI provider. The generated artifacts can be used with GitHub Copilot, ChatGPT, Claude, local models or plain human reviews.

---

### What is this project for?

Typical use cases:

- understand legacy RPG programs faster
- run impact analyses before changes
- make dependencies between programs, files and tables visible
- provide grounded context to AI assistants
- prepare modernization work
- support documentation and onboarding
- generate test ideas, deployment checklists and review artifacts
- keep IBM i analysis local and reproducible

Zeus is especially useful when an AI assistant should not reason blindly over old RPG sources, but should work from structured evidence.

---

### What Zeus does not do

Zeus does not replace responsible engineering, review or testing.

Zeus does not:

- automatically write business code to IBM i
- perform unreviewed changes on production systems
- replace developer review
- guarantee complete analysis when sources are incomplete
- act as an official IBM product
- have any affiliation, sponsorship or certification by IBM

All changes derived from Zeus output must be reviewed, tested and approved by humans.

---

### Safety model

The safe operating principle is:

> IBM i systems are read-only. Changes are prepared locally and reviewed as diffs.

This means:

- fetch, query and analysis workflows are designed around read-only operations
- credentials must never be committed
- real connection profiles belong in `config/local-only/`
- data-changing SQL must be reviewed and explicitly approved
- AI assistants may suggest changes, but must not modify production systems on their own
- generated artifacts may contain sensitive business logic and should be shared deliberately

For external review, use `--safe-sharing` where appropriate.

---

## Quickstart

### Option A: Local analysis without IBM i access

```bash
# 1. Install dependencies
npm install

# 2. Analyze a local RPG source tree
node cli/zeus.js analyze --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context

# 3. Open the local browser UI
node cli/zeus.js serve --source-output-root ./output
```

The local UI is available at:

```text
http://localhost:4782
```

Important output files:

```text
output/ORDERPGM/report.md
output/ORDERPGM/architecture-report.md
output/ORDERPGM/ai_prompt_documentation.md
output/ORDERPGM/canonical-analysis.json
```

---

### Option B: IBM i fetch with profiles

```bash
# 1. Install dependencies
npm install

# 2. Create a local profile
cp config/profiles.example.json config/local-only/profiles.json

# 3. Edit the profile
# config/local-only/profiles.json

# 4. Load environment variables
source ./config/load-env.sh
# or on Windows PowerShell:
# . .\config\load-env.ps1

# 5. Validate setup
node cli/zeus.js doctor --profile default

# 6. Fetch sources
node cli/zeus.js fetch --profile default-fetch

# 7. Analyze sources
node cli/zeus.js analyze --profile default --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context
```

Without IBM i access, place RPG files in `rpg_sources/` and run `analyze` directly.

---

## Installation

### Requirements

- Node.js 20 or newer
- Java 11 or newer
- optional: IBM i SSH/SFTP access for `fetch`
- optional: DB2/JT400 access for metadata, diagnostics and test data
- optional: `java/lib/jt400.jar` for Java helpers that access IBM i / DB2

### Install dependencies

```bash
npm install
```

### Run the CLI directly

```bash
node cli/zeus.js <command> [options]
```

### Link the CLI locally

```bash
npm link
zeus <command> [options]
```

---

## CLI commands

| Command | Purpose |
|---|---|
| `doctor` | checks environment, Java, profiles and env variables |
| `fetch` | downloads IBM i sources via SFTP, JT400 or FTP fallback |
| `analyze` | scans RPG/CL/DDS sources and generates analysis artifacts |
| `workflow` | runs predefined presets such as fetch → analyze → bundle |
| `bundle` | packages analysis artifacts as ZIP |
| `impact` | creates reverse impact analyses |
| `assess-risk` | classifies access and change risk |
| `generate-test` | creates test plans and Jest templates |
| `generate-checklist` | creates deployment checklists |
| `query-table` | reads DB2 table metadata |
| `query-sql` | executes read-only SQL |
| `field-search` | searches field/table usage locally, remotely or via SQL xref |
| `serve` | starts the local browser UI |
| `diff` | compares a local member with the IBM i version |

Example:

```bash
node cli/zeus.js doctor --profile default
node cli/zeus.js analyze --source ./rpg_sources --program ORDERPGM --out ./output
node cli/zeus.js serve --source-output-root ./output
```

---

## Workflow presets

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

## Profiles and environment variables

### Principle

Credentials do not belong in the repository.

- `config/local-only/profiles.json` is intended for local profiles.
- It should remain ignored by Git.
- Passwords and tokens are provided through environment variables.
- Profiles may contain placeholders such as `${env:ZEUS_DB_PASSWORD}`.
- Real values are loaded by the user in the shell session.

### Create a profile

```bash
cp config/profiles.example.json config/local-only/profiles.json
```

Windows PowerShell:

```powershell
Copy-Item config/profiles.example.json config/local-only/profiles.json
```

Then validate:

```bash
node cli/zeus.js doctor --profile default
```

### Common env variables

IBM i fetch:

```powershell
$env:ZEUS_FETCH_HOST       = "myibmi.example.com"
$env:ZEUS_FETCH_USER       = "MYUSER"
$env:ZEUS_FETCH_PASSWORD   = "secret"
$env:ZEUS_FETCH_SOURCE_LIB = "SOURCEN"
$env:ZEUS_FETCH_IFS_DIR    = "/home/zeus/rpg"
$env:ZEUS_FETCH_OUT        = "./rpg_sources"
```

DB2 metadata:

```powershell
$env:ZEUS_DB_HOST           = "myibmi.example.com"
$env:ZEUS_DB_USER           = "MYUSER"
$env:ZEUS_DB_PASSWORD       = "secret"
$env:ZEUS_DB_DEFAULT_SCHEMA = "MYLIB"
```

---

## AI prompts and Copilot

Two prompt files are relevant for AI-assisted IBM i work:

| File | When to use | Purpose |
|---|---|---|
| `docs/ai-session-prompt.md` | at the start of a concrete ticket session | turns the AI into an IBM i analysis assistant |
| `.github/copilot-instructions.md` | automatically loaded by GitHub Copilot in this repo | rules for developing Zeus itself |

Typical ticket-session starter:

```text
I am working in a multi-root workspace with a ticket folder and the Zeus RPG PromptKit repo.
Load the env file, validate the setup with `node cli/zeus.js doctor`, then work on this ticket:

CHANGE-1234: Check whether RECORD_ID 30363 still has a staging entry.
```

The AI should always work from evidence:

- read first
- analyze next
- then suggest changes
- prepare changes locally only
- show risky SQL or system actions before execution

---

## Analysis artifacts

After `analyze`, results are written to:

```text
output/<PROGRAM>/
```

Important files:

| File | Content |
|---|---|
| `report.md` | program summary |
| `architecture-report.md` | structure, call tree and dependencies |
| `canonical-analysis.json` | full entity and evidence model |
| `ai-knowledge.json` | token-optimized AI context |
| `ai_prompt_documentation.md` | ready-to-use prompt for explanation and documentation |
| `dependency-graph.md` | Mermaid dependency graph |
| `analyze-run-manifest.json` | run log and artifact overview |

Start local UI:

```bash
node cli/zeus.js serve --source-output-root ./output
```

---

## Architecture overview

### Node.js CLI

Main entry point:

```text
cli/zeus.js
```

Key areas:

| Area | Responsibility |
|---|---|
| `src/collector/` | source discovery |
| `src/scanner/` | RPG, CL, DDS and dependency scanners |
| `src/context/` | canonical analysis model and AI context |
| `src/dependency/` | dependency and call graphs |
| `src/report/` | Markdown and architecture reports |
| `src/prompt/` | prompt rendering and prompt contracts |
| `src/security/` | secret masking |
| `src/viewer/` | local browser view |
| `src/impact/` | reverse impact analysis |
| `src/analyze/` | analysis pipeline and stage registry |
| `src/java/` | Java runtime bridge |

### Java helpers

Java helpers under `java/` support IBM i and DB2-related tasks.

Typical classes:

| Class | Purpose |
|---|---|
| `IbmiCommandRunner` | run CL commands via JT400 |
| `IbmiMemberLister` | list source members in library/file |
| `IbmiSourceMemberExporter` | export source members |
| `IbmiIfsDownloader` | download IFS directory trees |
| `Db2DiagnosticQueryRunner` | run read-only DB2 SELECT statements |
| `Db2MetadataExporter` | export tables, columns, keys and triggers |
| `Db2ExternalObjectResolver` | resolve views, aliases and external objects |
| `Db2TestDataExtractor` | export masked sample data |
| `IbmiSourceSearcher` | search IBM i source members |

---

## Tests

```bash
npm test
npm run test:unit
npm run test:smoke
npm run test:contract
npm run test:corpus
npm run test:benchmark
```

The tests cover scanners, analysis contracts, runtime configuration, profiles, secret masking, local UI and VS Code extension contracts.

---

## Best practices

- Keep sources and analysis artifacts traceable.
- Store `zeus-import-manifest.json` together with fetched sources.
- Normalize encoding early, ideally to UTF-8.
- Start with `report.md` and `architecture-report.md`, then inspect JSON artifacts if needed.
- Include DB2 metadata when table behavior, constraints, triggers or dynamic SQL matter.
- Treat unresolved references as real uncertainty.
- Validate AI answers against `canonical-analysis.json`, reports and DB2 metadata.
- Use `--safe-sharing` before external sharing.
- Never put credentials into prompts, issues, artifacts or ZIP files.

---

## Anti-patterns

Avoid:

- pasting raw source trees into AI chats without structure
- skipping DB2 metadata when data behavior is critical
- ignoring mixed encodings
- treating sample test data as production truth
- ignoring unresolved references
- accepting generated AI output without review
- letting AI directly change production IBM i systems

---

## License

This project is licensed under the **Apache License 2.0**.

See:

```text
LICENSE
```

Apache License 2.0 is a permissive open-source license. It allows use, modification and redistribution, while requiring preservation of license notices, copyright notices and applicable NOTICE files. It also includes an explicit patent grant.

### Dependency note

The npm dependencies currently used by this project are permissively licensed, including MIT, ISC, BSD-3-Clause, Apache-2.0 or dual Apache-2.0/MIT licenses.

If `jt400.jar` / JTOpen is distributed with this project, document its license separately. According to IBM, JTOpen / IBM Toolbox for Java is governed by the IBM Public License. If the JAR is only provided locally by the user and is not part of the repository, a clear README note is usually sufficient.

Recommended:

- keep the full Apache-2.0 text in `LICENSE`
- optionally add a `NOTICE` file when required
- run a license checker regularly
- include third-party license texts when distributing third-party JARs

This is a technical open-source compliance assessment, not legal advice.

---

## Trademark Notice

IBM, IBM i, AS/400, DB2, JTOpen, JT400 and other product names mentioned in this project may be trademarks or registered trademarks of their respective owners.

This project is an independent open-source project and is not affiliated with, endorsed by, sponsored by, or certified by IBM or any other vendor.

All trademarks belong to their respective owners.
