# ⚡ Zeus RPG PromptKit

**Evidence-First Context Builder für IBM i RPG, CL & DDS**

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)
![Java](https://img.shields.io/badge/Java-11+-blue?logo=openjdk)
![IBM i](https://img.shields.io/badge/Platform-IBM%20i%20/%20AS%2F400-1F70C1)
![DB2](https://img.shields.io/badge/DB-DB2-0F62FE)
![License](https://img.shields.io/badge/License-Apache%202.0-green)
![Status](https://img.shields.io/badge/Status-Active%20Development-blueviolet)

![Zeus RPG PromptKit](./images/zeus-rpg-promptkit.png)

> **Quellen holen · Analysieren · Abhängigkeiten verstehen · KI mit hochwertigem Kontext versorgen.**

Zeus RPG PromptKit ist ein Open-Source-Toolkit, das IBM i / AS/400-Entwicklerinnen und -Entwicklern hilft, gewachsene RPG-, CL- und DDS-Systeme strukturiert zu analysieren und nachvollziehbaren Kontext für Menschen **und** KI-Assistenten zu erzeugen.

**Kein Code-Generator.** Sondern ein **Evidence Preparation Layer** – read-only, transparent und reviewbar.

> ⚠️ **Hinweis: Laufende Entwicklung / Active Development**  
> Dieses Projekt wird aktiv weiterentwickelt. Features, UI, Workflows und Schnittstellen können sich zwischen Releases ändern.

---

## Rechtlicher Hinweis, Marken & Haftung

Zeus RPG PromptKit ist ein eigenständiges Open-Source-Projekt und steht in keiner Verbindung zu IBM. Es ist weder von IBM entwickelt, unterstützt, geprüft, zertifiziert noch offiziell empfohlen.

IBM, IBM i, AS/400, DB2, RPG, CL, DDS, JT400, JTOpen und weitere genannte Produkt- oder Markennamen sind Marken oder eingetragene Marken der jeweiligen Rechteinhaber. Die Nennung dient ausschließlich der technischen Beschreibung des Einsatzbereichs.

Die Software wird im Rahmen der Apache License 2.0 **„as is“** bereitgestellt – ohne Gewährleistung irgendeiner Art. Nutzung, Konfiguration, Betrieb, Interpretation der erzeugten Analyseergebnisse sowie der Einsatz von KI-Assistenten auf Basis dieser Ergebnisse liegen vollständig in der Verantwortung der jeweiligen Anwenderinnen, Anwender und Betreiber.

Insbesondere ersetzt dieses Toolkit keine fachliche Prüfung, kein Code Review, keine Sicherheitsbewertung und keine Freigabeprozesse durch qualifizierte Personen. Vor produktiven Änderungen an IBM i-Systemen oder daraus abgeleiteten Anwendungen sind die erzeugten Artefakte sorgfältig zu prüfen.

---

## 🚀 Schnellstart – In 5 Minuten loslegen

### 1. Voraussetzungen

- Node.js 20+
- Java 11+ für JT400/DB2-Zugriff

### 2. Installation & Demo ausführen

```bash
git clone https://github.com/gzeuner/zeus-rpg-promptkit.git
cd zeus-rpg-promptkit
npm install

# Demo mit synthetischem RPG-System analysieren – perfekt zum Ausprobieren
./examples/demo-rpg-mini-system/scripts/run-demo.sh
```

### 3. Ergebnisse anschauen

```bash
# Lokale Viewer-UI starten
node cli/zeus.js serve --source-output-root ./examples/demo-rpg-mini-system/output-baseline
```

Öffne danach **http://localhost:4782** im Browser.

### 4. KI-Ready Prompt erzeugen

```bash
node ./examples/demo-rpg-mini-system/scripts/build-ai-session-prompt.mjs
```

In `output-baseline/` findest du sofort nutzbare Artefakte, zum Beispiel:

- `report.md`
- `architecture-report.md`
- `ai-knowledge.json`
- `dependency-graph.mmd`
- weitere Analyse-, Kontext- und Review-Artefakte

---

## ✨ Kern-Features

- **📥 Source Fetching** von IBM i per SFTP, JT400 oder FTP
- **🔍 Statische Analyse** von RPG III/IV, CL und DDS
- **🌐 Dependency Mapping** und Call-Graphs
- **🗄️ DB2 Metadata Integration** für Tabellen, Felder, Trigger und Constraints
- **🤖 KI-optimierte Artefakte** für Copilot, Claude, GPT, Grok und andere Assistenten
- **🖥️ Lokale Viewer-UI** zur interaktiven Inspektion
- **📋 Vordefinierte Workflows** für Onboarding, Impact Analysis, Modernization, Security Review und mehr
- **🔌 MCP (local-first, stdio)** mit allowlist, Redaction und lokalem Audit-Trail (MVP)
- **🛡️ Safety-First-Ansatz** mit read-only Defaults und lokaler Konfiguration

---

## Wofür ist Zeus RPG PromptKit geeignet?

- Schnelles Verständnis gewachsener RPG-Programme
- Sichere Impact-Analysen vor Änderungen
- Vorbereitung von Modernisierungsprojekten
- Bereitstellung hochwertiger Kontextdaten für KI-gestützte Entwicklung
- Technisches Onboarding neuer Teammitglieder
- Erstellung von Review-, Architektur- und Dokumentationsartefakten

---

## Installation für echte IBM i-Systeme

```bash
npm install
cp config/profiles.example.json config/local-only/profiles.json
# Profile und Umgebungsvariablen anpassen – siehe docs/
```

Alle Befehle und Presets findest du im **[Tool Catalog](docs/tool-catalog.md)**.

---

## MCP Support (Experimental MVP)

Der Branch enthält eine **lokale MCP-Server-Integration** für sichere, read-only Tool-Nutzung über `stdio`.

Aktueller Umfang:

- Transport: nur lokal, `stdio`
- Policy: default-deny für nicht allowlistete Tools
- Tool-Allowlist im CLI: `--allow-tools`
- Redaction: Response/Error-Payloads werden vor Emission maskiert
- Audit: append-only JSONL unter `.local/mcp/audit/mcp-audit.jsonl`

Aktuell verfügbare MCP-Tools:

- `zeus.health`
- `zeus.version`
- `zeus.doctor`
- `zeus.query-sql` (strict read-only: nur `SELECT`/`WITH`)

Startbeispiele:

```bash
# Standardstart (alle aktuell registrierten MVP-Tools)
node cli/zeus.js mcp serve --verbose

# Explizit eingeschränkte Allowlist
node cli/zeus.js mcp serve --verbose --allow-tools zeus.health,zeus.query-sql
```

Hinweise:

- MCP-Write-Operationen sind im MVP nicht freigeschaltet.
- Keine Credentials in tracked Dateien speichern.
- Für produktive Datenzugriffe nur mit geeigneter Profil- und Rollenprüfung arbeiten.

---

## Philosophie & Sicherheit

**„Evidence first, AI second.“**

Zeus RPG PromptKit soll KI nicht „blind“ machen, sondern besser erden: mit Quellen, Abhängigkeiten, Analyseergebnissen und prüfbaren Artefakten.

Safety-Level im Überblick:

- `S0` = local read-only – nur lokal lesen
- `S1` = local write – nur lokale Artefakte schreiben
- `S2` = remote read-only – IBM i/DB2 nur lesend anbinden
- `S3` = controlled write – kontrollierte Datenmutation mit Freigabe
- `S4` = operator-gated high risk – hochriskante, explizit gegatete Operationen

Grundprinzipien:

- IBM i-Zugriffe sind standardmäßig lesend ausgelegt.
- Lokale Konfiguration bleibt lokal.
- KI erhält prüfbare Fakten statt losem Bauchgefühl.
- Der Mensch bleibt immer in der Verantwortung.

Mehr dazu findest du im [Safety-Bereich der Dokumentation](docs/safety/).

---

## Dokumentation

- **Zentrale Übersicht**: [`docs/index.md`](docs/index.md)
- **Tool & Command Reference**: [`docs/tool-catalog.md`](docs/tool-catalog.md)
- **AI Session Prompt**: [`docs/ai/session-prompt.md`](docs/ai/session-prompt.md)
- **Quickstarts & Workflows**: [`docs/quickstart/`](docs/quickstart/) und [`docs/workflows/`](docs/workflows/)

---

## English Summary

**Zeus RPG PromptKit** is an open-source, evidence-first context builder for IBM i / AS/400 RPG, CL and DDS systems.

It helps developers, reviewers and AI assistants understand legacy codebases by collecting sources, analyzing dependencies, enriching results with metadata and producing structured, reviewable artifacts.

It is **not** a code generator. The goal is to prepare reliable context before humans or AI systems reason about modernization, impact analysis, onboarding or documentation.

### What it does

- Fetches IBM i sources through supported read-oriented access paths
- Analyzes RPG, CL and DDS code
- Builds dependency maps and call graphs
- Adds optional DB2 metadata context
- Generates Markdown, JSON and AI-ready context artifacts
- Provides a local viewer UI for inspection and review

### Project status

This project is under active development. Features, workflows, command options and generated artifacts may change between releases.

### Non-affiliation and disclaimer

Zeus RPG PromptKit is an independent open-source project. It is not affiliated with, endorsed by, certified by or supported by IBM.

IBM, IBM i, AS/400, DB2, RPG, CL, DDS, JT400, JTOpen and other product names are trademarks or registered trademarks of their respective owners. They are used only to describe the technical environment this project can work with.

The software is provided **“as is”**, without warranty of any kind, under the Apache License 2.0. Users and operators are solely responsible for installation, configuration, operation, review of generated artifacts and any use of AI assistants based on those artifacts.

Generated reports, prompts and analysis results must be reviewed by qualified humans before they are used for production decisions or system changes.

---

## License

Apache License 2.0 – see [LICENSE](LICENSE).

---

**Made with ❤️ für die IBM i Community**
