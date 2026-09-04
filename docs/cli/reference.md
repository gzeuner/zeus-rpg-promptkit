---
Title: CLI Reference Alias
Description: Stabiler Einstiegspunkt unter docs/cli mit Verweis auf den autoritativen Tool-Katalog.
Last Updated: 2026-06-19
---

# CLI Reference

Die verbindliche CLI-Referenz wird in [`../tool-catalog.md`](../tool-catalog.md) gepflegt.

Der unterstützte Produktpfad ist CLI-first:

- Agenten mit `zeus agent bootstrap --json` starten
- Befehle mit `zeus tools list --json` und `zeus tools describe <command> --json` entdecken
- Umgebung explizit in der Shell laden
- `doctor` vor profilbasierter Remote-Arbeit ausführen
- für vorhandene IBM-i-Spoolausgabe `spool-read` als begrenzten read-only S2-Weg verwenden
- danach Tool-Katalog und Safety-Policy befolgen
- MCP nur als optionalen Adapter verwenden
- den lokalen Viewer nur optional für vorhandene Artefakte nutzen

Related:

- [`../index.md`](../index.md)
- [`../ai/session-prompt.md`](../ai/session-prompt.md)
- [`../ai/cli-agent-guide.md`](../ai/cli-agent-guide.md)

Diese Datei bleibt bewusst ein stabiler Alias-Pfad unter `docs/cli/`, damit Menschen und KI-Assistenten einen vorhersehbaren Einstieg haben.
