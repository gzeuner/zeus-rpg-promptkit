---
title: Einheitliche Module und externe Erweiterungen
description: Öffentlicher Betriebsweg für das einheitliche Apache-2.0-Paket und bewusst explizite externe Erweiterungen.
lastUpdated: 2026-08-17
---

# Einheitliche Module und externe Erweiterungen

`zeus-rpg-promptkit` ist die einzige aktive Codebasis und steht vollständig unter Apache-2.0.
Die früher getrennten Professional-/Enterprise-Implementierungen sind – soweit technisch und
rechtlich freigegeben – als integrierte Module im öffentlichen Paket enthalten:

- `project-intelligence`
- `generation-assurance`
- `db2-test-intelligence`
- `ibmi-validation`

Die Entitlement-Prüfung bleibt eine Laufzeit-Produktpolicy. Sie ändert nicht die Projektlizenz.
Das Paket bleibt ohne gültige Lizenz oder ohne optionale Modulregistrierung benutzbar; geschützte
Fähigkeiten verweigern den Zugriff fail-closed.

## Basispaket

```bash
git clone https://github.com/gzeuner/zeus-rpg-promptkit.git
cd zeus-rpg-promptkit
npm install
npm run demo:run
node cli/zeus.js project-knowledge discover --json
```

Die neutralen Engines, CLI, API und MCP-Grundflächen funktionieren ohne Lizenzdokument und ohne
externe Module.

## Integrierte Module explizit aktivieren

Die Registrierung ist absichtlich explizit. Für die professionelle Standardauswahl:

```bash
node cli/zeus.js project-knowledge discover \
  --built-in-modules professional \
  --json
```

Oder mit einzelnen Modulen:

```bash
node cli/zeus.js project-knowledge discover \
  --built-in-modules project-intelligence,generation-assurance,db2-test-intelligence \
  --json
```

Für die Enterprise-Oberfläche kommt die owner-gated IBM-i-Validierung hinzu:

```bash
node cli/zeus.js project-knowledge discover \
  --built-in-modules enterprise \
  --json
```

License-Dokument und Public Key bleiben lokale Konfiguration. Niemals echte Lizenzen, private
Schlüssel, Kundendaten oder interne Pfade committen. Die API akzeptiert dafür die Optionen
`builtInModules`, `surface`, `licenseDocument`, `publicKeyPem` und die zugehörigen Trusted-Root-
Optionen.

## Project Intelligence verwenden

Index-, Query- und Kontextoperationen benötigen explizite absolute Trusted Roots:

```bash
node cli/zeus.js project-knowledge full-index \
  --built-in-modules professional \
  --knowledge-root /data/zeus-knowledge \
  --project-id demo \
  --trusted-roots '[{"rootId":"source","path":"/data/ibmi-sources"}]' \
  --json
```

Es gibt keinen impliziten Workspace-Scan. `review-ready` ist keine Compile- oder Deployment-
Freigabe; Live-IBM-i-Zugriffe bleiben standardmäßig deaktiviert und owner-gated.

## Externe Erweiterungen

Der frühere `commercialModuleLoader` bleibt als Kompatibilitäts- und Erweiterungspunkt erhalten.
Er lädt nur einen vom Host ausdrücklich angegebenen Paketnamen oder Pfad und führt diesen Code im
selben Prozess aus. Es gibt keine automatische Discovery, kein Fallback und keine Sandbox. Für
neue Produktfunktionalität ist die integrierte Built-in-Registrierung der maßgebliche Weg.

```js
const { createHostZeus } = require('zeus-rpg-promptkit/api');

const host = await createHostZeus({
  builtInModules: 'professional',
  licenseDocument,
  publicKeyPem,
});
```

Externe Erweiterungen verwenden weiterhin `--commercial-module` beziehungsweise die bestehende
API-Kompatibilität. Sie sind nicht erforderlich, um das öffentliche Produkt zu betreiben.

## Verifikation

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run package:smoke
npm run docs:check
npm run demo:run
git diff --check
```

Architektur und Ownership stehen in
[`docs/architecture/adr-014-unified-capability-consolidation.md`](../architecture/adr-014-unified-capability-consolidation.md).
