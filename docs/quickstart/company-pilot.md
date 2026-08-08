---
title: Firmenpilot mit Community und Commercial
description: Reproduzierbarer, read-only-orientierter Startablauf für einen ersten Firmentest.
---

# Firmenpilot

Dieser Ablauf ist für einen ersten Test gedacht. Er startet lokal, schreibt nur in ausdrücklich gewählte Artefaktverzeichnisse und aktiviert Commercial-Funktionen nur mit einer gültigen, extern abgelegten Lizenz.

## Einmalige Vorbereitung unter Windows

Voraussetzung ist Node.js 20 oder neuer. Beide Repositories müssen auf dem vorgesehenen Stand bleiben:

```powershell
cd C:\Java\workspace-java\zeus-rpg-promptkit-commercial
npm ci --ignore-scripts --no-audit --no-fund
npm ls zeus-rpg-promptkit --depth=0
```

Die letzte Ausgabe muss `zeus-rpg-promptkit@0.2.0-beta.5` mit dem im Commercial-`package.json` festgelegten Commit zeigen. So wird ein veraltetes lokales `node_modules` erkannt, bevor der Pilot beginnt.

Community-Smoke-Test:

```powershell
cd C:\Java\workspace-java\zeus-rpg-promptkit
npm run test:deployment:community
npm run package:smoke
```

## Community-only als sichere Fallback-Route

Diese Route funktioniert auch ohne Commercial-Lizenz und eignet sich als erster Funktionstest mit synthetischen oder freigegebenen Quellen:

```powershell
cd C:\Java\workspace-java\zeus-rpg-promptkit
node cli/zeus.js doctor --json
node cli/zeus.js project-knowledge discover --json
node cli/zeus.js analyze --help
```

Für den eigentlichen Lauf ein privates Profil verwenden und `outputRoot` außerhalb des Quell-Workspace setzen. Keine Produktions-Schreiboperationen und keine ungeprüften Kundendaten verwenden.

## Commercial explizit aktivieren

Lizenzdatei und Public Key bleiben außerhalb beider Repositories. In einer neuen PowerShell-Sitzung:

```powershell
$env:ZEUS_COMMERCIAL_MODULE = 'C:\Java\workspace-java\zeus-rpg-promptkit-commercial'
$env:ZEUS_LICENSE_DOCUMENT_PATH = 'C:\secure\zeus\license.json'
$env:ZEUS_LICENSE_PUBLIC_KEY_PATH = 'C:\secure\zeus\public.pem'
$env:ZEUS_COMMERCIAL_MODULES = 'project-intelligence'

cd C:\Java\workspace-java\zeus-rpg-promptkit
node cli/zeus.js project-knowledge discover --json
node cli/zeus.js project-knowledge status --json
```

Erst wenn `discover`/`status` das Commercial-Modul als vorhanden und lizenziert ausweisen, einen explizit erlaubten Trusted Root für einen Pilotlauf verwenden. Index-, Query- und Write-nahe MCP-Tools bleiben zunächst deaktiviert; `discover` und `status` genügen für die Integrationsprobe.

## Nach dem Pilotlauf

Artefakte, Lizenzmaterial und eventuelle Kundendaten nicht in Git übernehmen. Für einen reproduzierbaren Übergabestand genügen die beiden Commit-IDs, die Ausgaben von `doctor` und `project-knowledge status` sowie das separate Pilot-Artefaktverzeichnis.
