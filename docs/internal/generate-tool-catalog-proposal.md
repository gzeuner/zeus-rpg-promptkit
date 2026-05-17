---
Title: Proposal - docs:generate-catalog
Description: Vorschlag fuer einen CLI-Generator, der den Tool-Katalog aus Code-Metadaten deterministisch erzeugt.
Last Updated: 2026-05-17
---

# Proposal: `docs:generate-catalog`

## Status

Jetzt implementiert auf `main` als `zeus docs:generate-catalog` mit Alias `zeus docs generate-catalog`.

## Goal

Automatisches Erzeugen von `docs/tool-catalog.md` direkt aus CLI- und Workflow-Metadaten, um Drift zwischen Implementierung und Dokumentation zu verhindern.

Related:
- [`../tool-catalog.md`](../tool-catalog.md)
- [`../index.md`](../index.md)

## Proposed Command

```bash
zeus docs:generate-catalog [--output docs/tool-catalog.md] [--format markdown|json] [--json-output docs/tool-catalog.json]
```

## Scope

1. Parse Command-Surface aus `cli/zeus.js` und Command-Modulen.
2. Safety-Level/Scope/Purpose aus statischen Metadaten lesen.
3. Workflow-Presets aus `src/workflow/workflowPresetRegistry.js` einbeziehen.
4. Deterministische Markdown-Tabelle und optional JSON ausgeben.

## Benefits

- Verhindert Dokumentations-Drift.
- Erhoeht Konsistenz fuer alle KI-Assistenten.
- Ermoeglicht CI-Checks auf Katalog-Freshness.

## Implementation Suggestion

1. Command-Metadata-Map als kanonische Quelle einfuehren.
2. Generator-Service unter `src/docs/toolCatalogGenerator.js` ergänzen.
3. Command-Handler `src/cli/commands/docsGenerateCatalogCommand.js` nutzen.
4. CI-Check: generierter Output muss dem committed `docs/tool-catalog.md` entsprechen.

## Acceptance Criteria

- `docs:generate-catalog` erzeugt stabilen Output ohne manuelle Nacharbeit.
- Alle aktiven CLI-Commands erscheinen mit Safety/Scope/Purpose/Example.
- Workflow-Presets und empfohlene AI-Sequence werden mitgeneriert.
