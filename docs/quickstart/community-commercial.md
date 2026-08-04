---
title: Community und Commercial gemeinsam betreiben
description: Verifizierter Installations- und Betriebsweg für den öffentlichen Community-Core und das private Commercial-Modul.
lastUpdated: 2026-08-04
---

# Community und Commercial gemeinsam betreiben

Zeus besteht aus zwei bewusst getrennten Paketen:

- **Community:** öffentliches Apache-2.0-Paket `zeus-rpg-promptkit`. Es funktioniert vollständig ohne Commercial-Modul und stellt CLI, API, MCP, Analyse, Project-Knowledge-Engines und die neutralen Modulverträge bereit.
- **Commercial:** privates, separat verteiltes Paket `@zeus-pro/module-sdk-reference` aus dem Repository `zeus-rpg-promptkit-commercial`. Es enthält lizenzpflichtige Professional-/Enterprise-Module. Zugriff, Lizenzdokument und Public Key kommen vom Betreiber bzw. Anbieter; sie gehören nicht ins Community-Repository.

Der Community-Core lädt Commercial niemals automatisch. Das Commercial-Paket wird ausschließlich über einen expliziten Paketnamen oder Pfad registriert.

## 1. Community-only

Für lokale Analyse und die Community-Project-Knowledge-Engines:

```bash
git clone https://github.com/gzeuner/zeus-rpg-promptkit.git
cd zeus-rpg-promptkit
npm install
npm run demo:run
node cli/zeus.js project-knowledge discover --json
```

In diesem Modus ist `commercialLoader.loaded` `false`. Die Community-Engines bleiben nutzbar; Commercial-only-Operationen melden einen stabilen `ZPI.CAPABILITY_UNAVAILABLE`-Fehler und verändern keine Artefakte.

Für eine veröffentlichte Community-Version sollte ein Release-Tarball verwendet werden:

```bash
npm install https://github.com/gzeuner/zeus-rpg-promptkit/releases/download/v0.2.0-beta.5/zeus-rpg-promptkit-0.2.0-beta.5.tgz
```

## 2. Commercial installieren

Das Commercial-Repository ist privat und nicht als öffentliches npm-Paket veröffentlicht. Nach erteilter Repository- und Lizenzfreigabe wird es in der Host-Anwendung installiert, zum Beispiel:

```bash
npm install https://github.com/gzeuner/zeus-rpg-promptkit/releases/download/v0.2.0-beta.5/zeus-rpg-promptkit-0.2.0-beta.5.tgz
npm install git+ssh://git@github.com/gzeuner/zeus-rpg-promptkit-commercial.git
```

Alternativ kann während der Entwicklung ein lokaler Pfad verwendet werden. Der Host muss das Paket mit seinem Export `registerWithZeus(zeus, options)` erreichen können. Das Laden eines Pakets führt JavaScript im selben Prozess aus und ist deshalb eine Vertrauensentscheidung, keine Sandbox.

## 3. Lizenz und explizite Registrierung

Lizenzdatei und Public Key werden lokal außerhalb des Repositories abgelegt. Niemals echte Lizenzen, Kundendaten oder private Schlüssel committen.

PowerShell:

```powershell
$env:ZEUS_COMMERCIAL_MODULE='@zeus-pro/module-sdk-reference'
$env:ZEUS_LICENSE_DOCUMENT_PATH='C:\secure\zeus\license.json'
$env:ZEUS_LICENSE_PUBLIC_KEY_PATH='C:\secure\zeus\public.pem'
$env:ZEUS_COMMERCIAL_MODULES='project-intelligence'
```

Bash:

```bash
export ZEUS_COMMERCIAL_MODULE='@zeus-pro/module-sdk-reference'
export ZEUS_LICENSE_DOCUMENT_PATH='/secure/zeus/license.json'
export ZEUS_LICENSE_PUBLIC_KEY_PATH='/secure/zeus/public.pem'
export ZEUS_COMMERCIAL_MODULES='project-intelligence'
```

Die Auflösungsreihenfolge ist: CLI/API-Optionen, dann Umgebungsvariablen, dann `profile.commercial`.

Mit Profil:

```json
{
  "dev": {
    "commercial": {
      "module": "${env:ZEUS_COMMERCIAL_MODULE}",
      "modules": ["project-intelligence"],
      "licenseDocumentPath": "${env:ZEUS_LICENSE_DOCUMENT_PATH}",
      "publicKeyPath": "${env:ZEUS_LICENSE_PUBLIC_KEY_PATH}"
    }
  }
}
```

Dann den Status prüfen:

```bash
zeus project-knowledge discover --profile dev --json
zeus project-knowledge status --profile dev --json
```

Ein erfolgreicher Lauf weist das Commercial-Modul als geladen aus und meldet die registrierten Fähigkeiten. Fehlt die Lizenz, ist sie abgelaufen oder ungültig, wird nur das Commercial-Modul deaktiviert; der Community-Core bleibt nutzbar.

## 4. Project Intelligence verwenden

Commercial-Operationen benötigen weiterhin einen absoluten, explizit erlaubten Trusted Root. Es gibt keinen impliziten Workspace-Scan:

```bash
zeus project-knowledge full-index \
  --profile dev \
  --knowledge-root /data/zeus-knowledge \
  --project-id demo \
  --trusted-roots '[{"rootId":"source","path":"/data/ibmi-sources"}]' \
  --json
```

Die verfügbaren Operationen sind `create-project`, `full-index`, `incremental-update`, `query`, `impact-analysis`, `build-context-package`, `inspect-snapshot` und `verify-integrity`. Community-Artefakte bleiben auch ohne Commercial lesbar.

## 5. MCP

Für MCP muss das Modul ebenfalls explizit geladen werden. `discover` und `status` sind die sicheren Standardflächen; Index-/Query-/Write-nahe Operationen benötigen zusätzlich eine enge `--allow-tools`-Liste:

```bash
zeus mcp serve \
  --profile dev \
  --commercial-module @zeus-pro/module-sdk-reference \
  --allow-tools zeus.project-knowledge.discover,zeus.project-knowledge.status
```

Weitere MCP-Tools nur einzeln und nach Prüfung freigeben. Siehe [`docs/mcp/operator-guide.md`](../mcp/operator-guide.md).

## 6. Versionierung und Verifikation

Das Commercial-Paket pinnt absichtlich einen veröffentlichten Community-Release und nicht automatisch den neuesten `main`-Snapshot. Der aktuell dokumentierte Beta-5-Pin ist `487cca7b06d287b7d5cb53024ca54747500dd584`. Für Produktion müssen Community-Release, Commercial-Pin und Lizenzfreigabe zusammenpassen. Nach jedem neuen Community-Release muss Commercial alle Pin-Stellen aktualisieren und seine eigenen Gates erneut ausführen.

Community-Verifikation:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run package:smoke
```

Commercial-Verifikation im privaten Repository:

```bash
npm run test:discovery
npm test
npm run package:smoke
npm run audit:prod
```

Die beiden Pakete sind damit getrennt installierbar und über die öffentliche Modulregistrierung integrierbar. Die Community-Abhängigkeit bleibt ohne Commercial funktionsfähig; Commercial-only-Fähigkeiten erscheinen erst nach expliziter Registrierung und erfolgreicher Entitlement-Prüfung.
