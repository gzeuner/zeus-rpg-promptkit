# ⚡ Zeus RPG PromptKit

**Evidence-First Context Builder für IBM i RPG, CL & DDS**

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)
![Java](https://img.shields.io/badge/Java-11+-blue?logo=openjdk&logoColor=white)
![IBM i](https://img.shields.io/badge/Platform-IBM%20i%20/%20AS%2F400-1F70C1)
![DB2](https://img.shields.io/badge/DB-DB2-0F62FE)
![License](https://img.shields.io/badge/License-Apache%202.0-green)
![Status](https://img.shields.io/badge/Status-Active%20Development-blueviolet)

![Zeus RPG PromptKit](./images/zeus-rpg-promptkit.png)

> **Quellen holen · Analysieren · Abhängigkeiten verstehen · KI mit hochwertigem Kontext versorgen.**

Zeus RPG PromptKit ist ein Open-Source-Toolkit, das IBM i / AS/400 Entwicklern hilft, Legacy-RPG-Programme, CL und DDS strukturiert zu analysieren und perfekten, nachvollziehbaren Kontext für Menschen **und** KI-Assistenten zu erzeugen.

**Kein Code-Generator.** Sondern ein **Evidence Preparation Layer** – read-only, transparent und reviewbar.

---

## 🚀 Schnellstart – In 5 Minuten loslegen

### 1. Voraussetzungen
- Node.js 20+
- Java 11+ (für JT400/DB2 Zugriff)

### 2. Installation & Demo ausführen

```bash
git clone https://github.com/gzeuner/zeus-rpg-promptkit.git
cd zeus-rpg-promptkit
npm install

# Demo mit synthetischem RPG-System analysieren (perfekt zum Ausprobieren)
./examples/demo-rpg-mini-system/scripts/run-demo.sh
```

### 3. Ergebnisse anschauen

```bash
# Lokale Viewer-UI starten
node cli/zeus.js serve --source-output-root ./examples/demo-rpg-mini-system/output-baseline
```

Öffne **http://localhost:4782** im Browser.

### 4. KI-Ready Prompt erzeugen
```bash
node ./examples/demo-rpg-mini-system/scripts/build-ai-session-prompt.mjs
```

Du findest in `output-baseline/` sofort nutzbare Artefakte:
- `report.md`
- `architecture-report.md`
- `ai-knowledge.json`
- `dependency-graph.mmd`
- uvm.

---

## ✨ Kern-Features

- **📥 Source Fetching** von IBM i (SFTP, JT400, FTP)
- **🔍 Statische Analyse** von RPG III/IV, CL, DDS
- **🌐 Vollständiges Dependency Mapping** & Call-Graphs
- **🗄️ DB2 Metadata Integration** (Tabellen, Felder, Triggers, Constraints)
- **🤖 AI-optimierte Artefakte** für Copilot, Claude, GPT, Grok etc.
- **🖥️ Lokale Viewer UI** zur interaktiven Inspektion
- **📋 Vordefinierte Workflows** (Onboarding, Impact Analysis, Modernization, Security Review …)
- **🛡️ Safety-First** – Read-only Default, Credentials niemals im Repo

---

## Wofür ist Zeus perfekt geeignet?

- Schnelles Verständnis von gewachsenen RPG-Programmen
- Sichere Impact-Analysen vor Änderungen
- Vorbereitung von Modernisierungsprojekten
- Bereitstellung von Kontext für KI-gestützte Entwicklung
- Technisches Onboarding neuer Teammitglieder
- Erstellung von Review- und Dokumentations-Artefakten

---

## Installation für echte IBM i Systeme

```bash
npm install
cp config/profiles.example.json config/local-only/profiles.json
# Profile und Umgebungsvariablen anpassen (siehe docs/)
```

Alle Befehle und Presets findest du in der **[Tool Catalog](docs/tool-catalog.md)**.

---

## Philosophie & Sicherheit

**„Evidence first, AI second.“**

- Nur lesender Zugriff auf IBM i
- Alle Credentials bleiben lokal (`config/local-only/`)
- KI bekommt **prüfbare Fakten**, keine Halluzinationen
- Der Mensch bleibt immer in der Verantwortung

Mehr dazu im [Safety-Bereich der Docs](docs/safety/).

---

## Dokumentation

- **Zentrale Übersicht**: [`docs/index.md`](docs/index.md)
- **Tool & Command Reference** (KI-ready): [`docs/tool-catalog.md`](docs/tool-catalog.md)
- **AI Session Prompt**: [`docs/ai/session-prompt.md`](docs/ai/session-prompt.md)
- **Beispiel-Workflows & Quickstarts**: [`docs/quickstart/`](docs/quickstart/) und [`docs/workflows/`](docs/workflows/)

---

## Lizenz

Apache License 2.0 – siehe [LICENSE](LICENSE)

---

**Made with ❤️ für die IBM i Community**