# PROJECT Environment Setup

Die System-Profile trennen drei Rollen:

- SYS_TEST als primaeres Arbeits- und Fetch-System
- SYS_PROD als Quelle fuer produktive Metadaten und bei Bedarf Testdaten
- BIB, APPLIB und ASE als getrennte Source-Libraries auf SYS_TEST

**Env-Vars haben immer Vorrang vor Profilwerten.** Das erlaubt Multi-Maschinen-Setups
ohne Profile anzufassen — z.B. Sourcen von SYS_TEST fetchen, Metadaten aber gegen
SYS_PROD abfragen, indem nur `ZEUS_METADATA_DB_HOST=SYS_PROD` im env gesetzt wird.

## Benoetigte Umgebungsvariablen

### Fetch auf SYS_TEST

- `ZEUS_FETCH_HOST`
  Wert: Hostname oder Adresse von SYS_TEST
- `ZEUS_FETCH_USER`
  Wert: IBM i Benutzer fuer Source-Fetch
- `ZEUS_FETCH_PASSWORD`
  Wert: IBM i Passwort fuer Source-Fetch
- `ZEUS_FETCH_IFS_DIR`
  Wert: Temporaeres IFS-Verzeichnis fuer Export, z. B. `/tmp/zeus-fetch`

### Default-DB auf SYS_TEST

- `ZEUS_DB_HOST`
  Wert: Hostname oder Adresse von SYS_TEST
- `ZEUS_DB_USER`
  Wert: Benutzer fuer Standard-DB-Zugriff auf SYS_TEST
- `ZEUS_DB_PASSWORD`
  Wert: Passwort fuer Standard-DB-Zugriff auf SYS_TEST

### Metadaten auf SYS_PROD (optional — Multi-Maschinen)

Wenn nicht gesetzt, faellt zeus auf `ZEUS_DB_*` zurueck (alles gegen SYS_TEST).

- `ZEUS_METADATA_DB_HOST`
  Wert: Hostname oder Adresse von SYS_PROD
- `ZEUS_METADATA_DB_USER`
  Wert: Benutzer fuer Katalog- und Metadatenabfragen auf SYS_PROD
- `ZEUS_METADATA_DB_PASSWORD`
  Wert: Passwort fuer Katalog- und Metadatenabfragen auf SYS_PROD

### Testdaten auf SYS_PROD (optional)

Wenn nicht gesetzt, faellt zeus auf `ZEUS_METADATA_DB_*` zurueck.

- `ZEUS_TESTDATA_DB_HOST`
  Wert: Hostname oder Adresse von SYS_PROD (meist identisch mit METADATA)
- `ZEUS_TESTDATA_DB_USER`
  Wert: Benutzer fuer read-only Datenabfragen auf SYS_PROD
- `ZEUS_TESTDATA_DB_PASSWORD`
  Wert: Passwort fuer read-only Datenabfragen auf SYS_PROD

## Profilzuordnung

- `sample-source`
  Zweck: Produktivnahe Source-Basis aus Library `SOURCEN`
- `sample-objecttest`
  Zweck: neu entwickelte oder geaenderte Quellen aus `APPLIB`
- `sample-ase`
  Zweck: laufende Entwicklung aus `ASE`

Alle drei Profile:

- fetchen Quellen von SYS_TEST
- verwenden standardmaessig `APPDATA` als DB-Schema/Bibliothek
- leiten `dbRoles.metadata` und `dbRoles.testData` auf SYS_PROD um
  (sofern `ZEUS_METADATA_DB_HOST` gesetzt ist)

## Szenario A — Alles auf SYS_TEST

Einfachstes Setup: ein System, kein Multi-Maschinen-Routing.

```ini
# config/.env.project.local
ZEUS_FETCH_HOST=SYS_TEST
ZEUS_FETCH_USER=IBMI_USER
ZEUS_FETCH_PASSWORD=***
ZEUS_FETCH_IFS_DIR=/tmp/zeus-fetch

ZEUS_DB_HOST=SYS_TEST
ZEUS_DB_USER=IBMI_USER
ZEUS_DB_PASSWORD=***
ZEUS_DB_DEFAULT_SCHEMA=APPDATA
```

## Szenario B — Sourcen SYS_TEST, Metadaten/Analysen SYS_PROD

```ini
# config/.env.project.local
ZEUS_FETCH_HOST=SYS_TEST
ZEUS_FETCH_USER=IBMI_USER
ZEUS_FETCH_PASSWORD=***
ZEUS_FETCH_IFS_DIR=/tmp/zeus-fetch

ZEUS_DB_HOST=SYS_TEST
ZEUS_DB_USER=IBMI_USER
ZEUS_DB_PASSWORD=***
ZEUS_DB_DEFAULT_SCHEMA=APPDATA

ZEUS_METADATA_DB_HOST=SYS_PROD
ZEUS_METADATA_DB_USER=IBMI_USER
ZEUS_METADATA_DB_PASSWORD=***
ZEUS_METADATA_DB_DEFAULT_SCHEMA=APPDATA

ZEUS_TESTDATA_DB_HOST=SYS_PROD
ZEUS_TESTDATA_DB_USER=IBMI_USER
ZEUS_TESTDATA_DB_PASSWORD=***
```

## Laden in PowerShell

```powershell
cd C:\Users\Developer.User\Tools\zeus-rpg-promptkit
. .\config\load-env.ps1 -Environment project

# Pruefen ob alles korrekt geladen wurde:
node cli/zeus.js doctor --profile sample-ase --show-resolved
```

## Neue Befehle dieser Session

### inspect-object — Objektinfo direkt von IBM i

```powershell
# Zeigt kompiliertes Objekt inkl. Journal-Status
node cli/zeus.js inspect-object --profile sample-ase --lib APPLIB --name APP_TABLE_00 --type *FILE

# Nur Journal-Status
node cli/zeus.js inspect-object --profile sample-ase --lib APPLIB --name APP_TABLE_00 --type *FILE --journal
```

### test-run — Before/After-Snapshot + Rollback-SQL

Szenario: Vor einem Integrationstest einen Snapshot aufnehmen, nach dem Test den
Diff ermitteln und bei Bedarf Rollback-SQL anzeigen (wird NICHT automatisch ausgefuehrt).

```powershell
# 1. Vor dem Test: Before-Snapshot
node cli/zeus.js test-run start --profile sample-ase `
    --program APPPGM `
    --table APPLIB.APP_TABLE_00 `
    --key ID=88656 `
    --label "CHANGE-1234 Test DAN=127002"

# 2. Test durchfuehren (manuell)

# 3. After-Snapshot + Diff
node cli/zeus.js test-run capture --profile sample-ase --manifest test-run-manifest.json

# 4. Rollback-SQL anzeigen (nur lesen, nicht ausfuehren!)
node cli/zeus.js test-run rollback --manifest test-run-manifest.json
```

## Empfohlene Reihenfolge

1. `sample-source` fuer die produktionsnahe Ausgangslage verwenden.
2. `sample-objecttest` gegenpruefen, wenn ein Change oder ein Hotfix kurz vor Produktivnahme steht.
3. `sample-ase` nur dann dazunehmen, wenn die Ursache vermutlich noch in aktiver Entwicklung liegt.
4. Fuer Support-Tickets zuerst Metadaten via SYS_PROD lesen und nur bei Bedarf read-only Testdaten ziehen.