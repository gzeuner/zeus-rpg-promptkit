---
Title: Prompt Workbench Architecture
Description: Zielarchitektur und Integrationspfad fuer die experimentelle lokale Prompt Workbench im bestehenden Node.js-Toolset.
Last Updated: 2026-06-19
---

# Prompt Workbench Architecture

This document describes an experimental, local-only Prompt Workbench inside `zeus serve`.
It is not the supported primary workflow and does not replace CLI/MCP commands or shell env loading.

## Zielarchitektur
Die Prompt Workbench wird als additive Erweiterung des bestehenden `zeus serve` Stacks umgesetzt.

- Bestehender Entry Point bleibt: `src/ui/localUiServer.js`
- Bestehende Run-Explorer-Routen bleiben unveraendert
- Neue Builder-Routen laufen unter `/api/prompt-builder/*`
- Prompt-Composition und Template-Persistenz sind als getrennte UI-Services kapsuliert

## Neue und angepasste Module

Neue Module:
- `src/ui/promptWorkbenchRegistry.js`
- `src/ui/promptWorkbenchTemplateStore.js`
- `src/ui/promptWorkbenchService.js`

Angepasst:
- `src/ui/localUiServer.js`

### Verantwortlichkeiten

`promptWorkbenchRegistry.js`
- Use-Case Registry
- Modul-Registry fuer Prompt-Bausteine
- deterministische Prompt-Vorschau-Komposition

`promptWorkbenchTemplateStore.js`
- lokale Template-CRUD-Funktionen
- Dateipfad-Normalisierung
- JSON-Store (`config/local-only/prompt-workbench/templates.json` per Default)

`promptWorkbenchService.js`
- API-nahe Validierung
- Contract-Metadaten
- Orchestrierung von Registry + Store + Token-Schaetzung

`localUiServer.js`
- Route-Dispatch fuer Prompt-Builder-Endpunkte
- JSON-Body Parsing
- Method-Guards mit `Allow` Headern

## API Contract (v1)
- `GET /api/prompt-builder/contracts`
- `GET /api/prompt-builder/use-cases`
- `GET /api/prompt-builder/modules`
- `POST /api/prompt-builder/preview`
- `GET /api/prompt-builder/templates`
- `POST /api/prompt-builder/templates`
- `GET /api/prompt-builder/templates/:templateId`
- `PUT /api/prompt-builder/templates/:templateId`
- `DELETE /api/prompt-builder/templates/:templateId`

## Migrationspfad ohne Bruch
1. Prompt-Builder API parallel zu bestehenden Run-Explorer-Routen bereitstellen.
2. Bestehende UI-Flaechen und CLI-Verhalten unveraendert lassen.
3. Frontend-Workbench schrittweise auf neue Endpunkte aufsetzen.
4. Regression-Tests fuer bestehende API-Routen beibehalten und erweitern.

## Technische Risiken und Gegenmassnahmen

Risiko: Unsauberes Input-Handling bei JSON-Payloads.
- Gegenmassnahme: zentrale Body-Validierung, Groessenlimit, konsistente Fehlerantworten.

Risiko: Template-Store kollidiert mit Team-Workflows.
- Gegenmassnahme: lokaler, gitignorierter Standardpfad unter `config/local-only/`.

Risiko: Regression in bestehenden Local-UI-Routen.
- Gegenmassnahme: additive Route-Struktur und bestehende Testabdeckung weiter nutzen.
