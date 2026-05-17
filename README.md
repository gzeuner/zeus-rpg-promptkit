# ⚡ Zeus RPG PromptKit

**Evidence-First Context Builder für IBM i RPG, CL & DDS**

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)
![Java](https://img.shields.io/badge/Java-11+-blue?logo=openjdk&logoColor=white)
![IBM i](https://img.shields.io/badge/Platform-IBM%20i%20/%20AS%2F400-1F70C1)
![DB2](https://img.shields.io/badge/DB-DB2-0F62FE)
![License](https://img.shields.io/badge/License-Apache%202.0-green)
![Status](https://img.shields.io/badge/Status-Active%20Development-blueviolet)

![Zeus RPG PromptKit](./images/zeus-rpg-promptkit.png)

> **Quellen holen · Analysieren · Abhängigkeiten verstehen · KI mit hochwertigem, nachvollziehbarem Kontext versorgen.**

Zeus RPG PromptKit ist ein Open-Source-Toolkit, das IBM i / AS/400 Entwicklern, Architekten und Modernisierern hilft, Legacy-RPG-Programme, CL und DDS strukturiert zu analysieren und **perfekte, prüfbare Kontexte** für Menschen **und** KI-Assistenten zu erzeugen.

**Kein Code-Generator.** Sondern ein **Evidence Preparation Layer** – read-only, transparent und vollständig reviewbar.

---

## 🚀 Schnellstart – In 5 Minuten loslegen

### 1. Voraussetzungen
- Node.js 20+
- Java 11+ (für JT400/DB2-Zugriff)

### 2. Installation & Demo

```bash
git clone https://github.com/gzeuner/zeus-rpg-promptkit.git
cd zeus-rpg-promptkit
npm install

# Demo mit synthetischem RPG-System analysieren
./examples/demo-rpg-mini-system/scripts/run-demo.sh
```

### 3. KI-ready Artefakte nutzen

Nach der Analyse liegen im Ordner `examples/demo-rpg-mini-system/output-baseline/PROGRAM_100/` alle wichtigen Dateien bereit:
- `ai-knowledge.json` – optimierter Kontext für KI
- `report.md` und `architecture-report.md`
- `dependency-graph.mmd` (Mermaid)
- uvm.

Einen vollständigen AI-Session-Prompt erzeugst du mit:

```bash
node ./examples/demo-rpg-mini-system/scripts/build-ai-session-prompt.mjs
```

---

## ✨ Kern-Features

- **📥 Source Fetching** von IBM i (SFTP, JT400, FTP)
- **🔍 Tiefgehende statische Analyse** von RPG III/IV, CL, DDS
- **🌐 Vollständiges Dependency Mapping** & Call-Graphs
- **🗄️ DB2 Metadata Integration** (Tabellen, Felder, Triggers, Constraints, Views)
- **🤖 AI-optimierte Artefakte** – speziell aufbereitet für Claude, GPT, Cursor, Grok etc.
- **📋 Vordefinierte Analyse-Workflows** (Documentation, Impact Analysis, Security Review, Modernization Roadmap …)
- **🛡️ Safety-First** – Read-only Default, Credentials niemals im Repo

---

## Wofür ist Zeus RPG PromptKit ideal?

- Schnelles tiefes Verständnis von komplexen, gewachsenen RPG-Programmen
- Sichere Impact-Analysen vor Code-Änderungen
- Vorbereitung von Modernisierungs- und Refactoring-Projekten
- Bereitstellung von hochwertigem Kontext für KI-gestützte Entwicklung
- Technisches Onboarding neuer Teammitglieder
- Erstellung von Dokumentationen, Reviews und Architektur-Artefakten

---

## English Version

**Zeus RPG PromptKit – Evidence-First Context Builder for IBM i RPG, CL & DDS**

Zeus RPG PromptKit is an open-source toolkit that helps IBM i / AS/400 developers, architects and modernization teams to analyze legacy RPG, CL and DDS programs in a structured way and generate **high-quality, verifiable context** for both humans and AI assistants (Claude, GPT, Cursor, Grok etc.).

**Not a code generator.** It is an **Evidence Preparation Layer** – read-only, transparent and fully auditable.

### Quick Start

```bash
git clone https://github.com/gzeuner/zeus-rpg-promptkit.git
cd zeus-rpg-promptkit
npm install
./examples/demo-rpg-mini-system/scripts/run-demo.sh
node ./examples/demo-rpg-mini-system/scripts/build-ai-session-prompt.mjs
```

### Key Features

- Source fetching from IBM i (SFTP, JT400, FTP)
- Deep static analysis of RPG III/IV, CL, DDS
- Complete dependency mapping & call graphs
- DB2 metadata integration
- AI-optimized artifacts and prompts
- Predefined analysis workflows
- Security-first design

---

## Installation für echte IBM i Systeme

```bash
npm install
cp config/profiles.example.json config/local-only/profiles.json
```

Passe die Profile in `config/local-only/profiles.json` und ggf. Umgebungsvariablen an (siehe `docs/`).

Alle verfügbaren Befehle und Presets findest du in der **[Tool Catalog](docs/tool-catalog.md)**.

---

## Philosophie & Sicherheit

**„Evidence first, AI second.“**

- Nur lesender Zugriff auf dein IBM i System
- Alle sensiblen Daten bleiben lokal
- Die KI erhält **prüfbare Fakten** statt Halluzinationen
- Der Entwickler behält die volle Kontrolle und Verantwortung

---

## Dokumentation

- [Zentrale Dokumentation](docs/index.md)
- [Tool Catalog & Command Reference](docs/tool-catalog.md)
- [AI Session Prompt Guide](docs/ai/session-prompt.md)
- [Quickstarts & Workflows](docs/quickstart/)

---

## Lizenz

Apache License 2.0 – siehe [LICENSE](LICENSE)

---

**Made with ❤️ for the IBM i / RPG Community**