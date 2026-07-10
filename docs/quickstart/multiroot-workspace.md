---
Title: Quickstart: Multi-Root Workspace fuer Ticket-basierte Analyse
Description: Schneller operativer Einstieg in typische Zeus-Workflows.
Last Updated: 2026-06-19
---

# Quickstart: Multi-Root Workspace fuer Ticket-basierte Analyse

Dieses Quickstart beschreibt die sichere Einrichtung eines Multi-Root Workspaces:
- **Ticket-Folder**: Deine Ticket-Inhalte (zeitlich begrenzt)
- **Zeus-Repo**: Das `zeus-rpg-promptkit` (persistent)

**Ziel**: Sichere, isolierte Analyse einzelner Tickets mit Credentials in der lokalen Session, nicht in Dateien.

## 1. Ticket-Ordner vorbereiten

```powershell
mkdir c:\Tickets\TICKET-12345
cd c:\Tickets\TICKET-12345
```

## 2. Arbeitsstruktur festlegen

Lege beide Ordner parallel bereit:
- `c:\Tickets\TICKET-12345`
- `c:\Tools\zeus-rpg-promptkit`

Nutze dein bevorzugtes Werkzeug, um zwischen beiden Verzeichnissen zu arbeiten.

## 3. Umgebungsvariablen laden

```powershell
cd c:\Tools\zeus-rpg-promptkit

. .\config\load-env.ps1 -Environment <environment>
```

## 4. Konfiguration prüfen

```powershell
node cli/zeus.js doctor --profile default --show-resolved
```

## 5. Quellen holen (optional)

```powershell
node cli/zeus.js fetch --profile default
```

## 6. Analyse durchführen

```powershell
node cli/zeus.js analyze --profile default
```

## 7. Artefakte auswerten

- Prüfe `output/` und `analysis/`.
- Starte optional den lokalen Viewer nur für bereits erzeugte Artefakte:

```powershell
node cli/zeus.js serve --source-output-root ./output
```

## 8. Sicherheit

Was committed werden darf:
- Code
- Vorlagen wie `.env.example` und `profiles.example.json`

Was nie committed werden darf:
- `.env.local`
- `profiles.json`
- Secrets

## 9. Nächste Schritte

1. Ticket-Ordner anlegen.
2. Env laden und `doctor` ausführen.
3. Optional `fetch`, dann `analyze`.
4. Ergebnisse im AI-Workflow verwenden.

Fragen? Siehe auch:
- [`../safety/best-practice-guide.md`](../safety/best-practice-guide.md)
- [`../workflows/investigation-workflows.md`](../workflows/investigation-workflows.md)
