---
title: Firmenpilot mit Zeus RPG PromptKit
description: Reproduzierbarer, read-only-orientierter Startablauf für einen ersten Firmentest mit der einheitlichen Apache-2.0-Codebasis.
lastUpdated: 2026-08-17
---

# Firmenpilot

Dieser Ablauf ist für einen ersten Test gedacht. Er schreibt nur in ausdrücklich gewählte
Artefaktverzeichnisse und aktiviert geschützte Built-in-Funktionen nur mit einer gültigen,
extern abgelegten Lizenz.

## Einmalige Vorbereitung unter Windows

Voraussetzung ist Node.js 20 oder neuer. Es gibt eine aktive Codebasis:

```powershell
cd C:\Java\workspace-java\zeus-rpg-promptkit
npm ci --ignore-scripts --no-audit --no-fund
npm run test:deployment:community
npm run package:smoke
```

## Basispaket als sichere Fallback-Route

Diese Route funktioniert auch ohne Lizenz und eignet sich als erster Funktionstest mit synthetischen
oder freigegebenen Quellen:

```powershell
node cli/zeus.js doctor --json
node cli/zeus.js project-knowledge discover --json
node cli/zeus.js analyze --help
```

Für den eigentlichen Lauf ein privates Profil verwenden und `outputRoot` außerhalb des Quell-
Workspace setzen. Keine Produktions-Schreiboperationen und keine ungeprüften Kundendaten verwenden.

## Integrierte Funktionen explizit aktivieren

Lizenzdatei und Public Key bleiben außerhalb des Repositories. In einer neuen PowerShell-Sitzung:

```powershell
$env:ZEUS_BUILT_IN_MODULES = 'professional'
$env:ZEUS_LICENSE_DOCUMENT_PATH = 'C:\secure\zeus\license.json'
$env:ZEUS_LICENSE_PUBLIC_KEY_PATH = 'C:\secure\zeus\public.pem'

cd C:\Java\workspace-java\zeus-rpg-promptkit
node cli/zeus.js project-knowledge discover --json
node cli/zeus.js project-knowledge status --json
```

Erst wenn `discover`/`status` die erwarteten Fähigkeiten als vorhanden ausweisen, einen explizit
erlaubten Trusted Root für einen Pilotlauf verwenden. Index-, Query- und Write-nahe MCP-Tools
bleiben zunächst deaktiviert; `discover` und `status` genügen für die Integrationsprobe.

## Nach dem Pilotlauf

Artefakte, Lizenzmaterial und eventuelle Kundendaten nicht in Git übernehmen. Für einen
reproduzierbaren Übergabestand genügen die Commit-ID, die Ausgaben von `doctor` und
`project-knowledge status` sowie das separate Pilot-Artefaktverzeichnis.
