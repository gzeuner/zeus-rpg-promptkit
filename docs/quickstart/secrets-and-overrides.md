# How To: Secrets, Overrides & Source-Ablage

**Wichtige How-To-Themen** für den sicheren und effizienten Umgang mit Zeus RPG PromptKit:

1. Verschlüsselte Passwörter (Secret Vault / Encryption & Decryption)
2. CLI-Overrides für Bibliotheken / Dateien / Schemas
3. Wo gefetchte Sourcen landen

Siehe auch die Abschnitte im [README](../../README.md) unter "How To".

1. Verschlüsselte Passwörter (kein Klartext in `.env`)
2. Bibliotheken/Dateien/Schemas jederzeit per CLI überschreiben
3. Wo die gefetchten Sourcen landen

---

## 1. Verschlüsselte Passwörter (Secret Vault)

Passwörter müssen **nicht** im Klartext in `.env`-Dateien oder Profilen stehen. Werte im
Format `enc:v1:...` werden zur Laufzeit **transparent** entschlüsselt (AES-256-GCM).

### Einmalige Einrichtung

```powershell
# 1. Schlüssel erzeugen (liegt gitignoriert unter config/local-only/.zeus-key)
node cli/zeus.js secret init-key

# Auf Windows (empfohlen): DPAPI-geschützt (kein Klartext im FS):
#   node cli/zeus.js secret init-key --windows

# Alternativ: Schlüssel über Umgebungsvariable bereitstellen (hat Vorrang)
#   $env:ZEUS_SECRET_KEY = "<geheime-passphrase>"
```

### Passwort verschlüsseln

```powershell
node cli/zeus.js secret encrypt --value "MeinDbPasswort"
# -> enc:v1:BASE64....
```

Den ausgegebenen Token in die `.env` eintragen — genau dort, wo vorher der Klartext stand:

```dotenv
ZEUS_DB_PASSWORD=enc:v1:BASE64....
ZEUS_FETCH_PASSWORD=enc:v1:BASE64....
```

Das Profil bleibt unverändert (`"password": "${env:ZEUS_DB_PASSWORD}"`) — der Token wird
beim Auflösen automatisch entschlüsselt. Ebenso möglich: den `enc:v1:`-Wert direkt in ein
**privates** Profil schreiben.

### Prüfen & Fehlersuche

```powershell
node cli/zeus.js secret status              # Zeigt, ob/woher der Schlüssel geladen wird
node cli/zeus.js secret decrypt --value "enc:v1:..."   # Nur zum Testen
node cli/zeus.js doctor --profile <name>    # Check "Secret Vault" in der Diagnose
```

**Schlüssel-Quellen (Priorität):**

1. Umgebungsvariable `ZEUS_SECRET_KEY`
2. Windows Secure Storage (DPAPI): `zeus secret init-key --windows` (nur Windows, siehe unten)
3. Datei `config/local-only/.zeus-key` (gitignoriert)

> ⚠️ Ohne passenden Schlüssel schlägt die Auflösung eines `enc:v1:`-Werts bewusst **laut**
> fehl (keine stillen Leer-/Falschwerte). Der Schlüssel ist geheim und darf nicht geteilt
> oder eingecheckt werden. Wird der Schlüssel getauscht, müssen alle Werte neu verschlüsselt
> werden.

### Windows: DPAPI-geschützter Schlüssel (sicherste Variante auf Windows)

Statt einer Klartext-Datei `.zeus-key` kann der Schlüssel DPAPI-geschützt (pro Windows-Benutzerkonto) gespeichert werden:

```powershell
node cli/zeus.js secret init-key --windows
```

- Speicherort: `%USERPROFILE%\.zeus-secure-key.xml` (via `Export-Clixml` + DPAPI).
- Wird in `zeus secret status` als `windows-secure-xml (DPAPI-protected)` angezeigt.
- Bindung: Nur der anlegende Windows-User kann den Schlüssel wieder auslesen.
- Entfernen: `Remove-Item "$env:USERPROFILE\.zeus-secure-key.xml"`
- Wichtig: Wird die XML-Datei gelöscht oder der Befehl unter einem anderen User/auf einer anderen Maschine ausgeführt, sind bestehende `enc:v1:`-Tokens unlesbar und müssen neu verschlüsselt werden (neuer Schlüssel erforderlich).

Empfehlung: Auf Windows-Entwicklungsrechnern `--windows` nutzen, um Klartext-Schlüssel im Dateisystem zu vermeiden.

---

## 2. Bibliotheken / Dateien / Schemas per CLI überschreiben

Profilwerte lassen sich **jederzeit** durch CLI-Argumente übersteuern, ohne das Profil zu
ändern. CLI-Argumente haben Vorrang vor Env-Variablen und Profilwerten.

### fetch

| Zweck | Flag |
|---|---|
| Objekt-/Quellbibliothek | `--source-lib <LIB>` (Alias `--source-library`) |
| Quelldateien | `--source-files QRPGLESRC,QCPYSRC` (Alias `--files`) |
| Member (Filter) | `--members M1,M2` (Alias `--member`) |
| Zielverzeichnis | `--out <pfad>` |
| IFS-Arbeitsverzeichnis | `--ifs-dir <pfad>` |
| Host/User/Passwort | `--host` / `--user` / `--password` |
| Benanntes System | `--system <name>` |

```powershell
node cli/zeus.js fetch --profile dev --source-lib APPLIB --source-files QRPGLESRC,QCPYSRC --members ORDERPGM,CUSTSRV
node cli/zeus.js fetch --profile combined-fetch-and-query --system dev --members ORDERPGM
```

`--system <name>` ist für Mehrsystem-Profile gedacht. Der Name kann der `systems`-Key,
`systemName` oder ein Alias sein. Explizite CLI-Werte wie `--host` oder `--user` haben
weiterhin Vorrang, danach kommt der gewählte Systemblock, danach Env/Profile-Fallbacks.

### analyze

| Zweck | Flag |
|---|---|
| Source-Verzeichnis | `--source <pfad>` (Alias `--source-root`) |
| DB-Schema (Metadaten) | `--schema <NAME>` |
| DB-Bibliothek (Metadaten) | `--library <NAME>` (Alias `--lib`) |
| Dateiendungen | `--extensions .rpgle,.rpg` |

```powershell
node cli/zeus.js analyze --profile dev --source ./rpg_sources --member ORDERPGM --schema DATA_X --library APPLIB
```

### query-table / query-sql

| Zweck | Flag |
|---|---|
| Schema (query-table) | `--schema <NAME>` |
| Bibliotheksliste (query-sql) | `--liblist LIB1 LIB2 ...` |
| Default-Schema (query-sql) | `--default-schema <NAME>` |

`query-sql` kann mehrere read-only Statements (`SELECT` / `WITH`) in einem Lauf ausführen:

```powershell
node cli/zeus.js query-sql --profile dev --sql "SELECT CURRENT_USER FROM SYSIBM.SYSDUMMY1; SELECT CURRENT_SERVER FROM SYSIBM.SYSDUMMY1" --output json
node cli/zeus.js query-sql --profile dev --file ./diagnostics/read-only-checks.sql --output table
```

Semikola in einfachen oder doppelten SQL-Strings werden beim Splitten berücksichtigt. Die
Statements werden nach dem normalen Guard-Probe über einen gemeinsamen DB2-Runner-Aufruf
ausgeführt. JSON-Ausgabe enthält pro Statement ein eigenes Ergebnisobjekt.

### write-sql / insert / update / delete

Guarded DML-Befehle akzeptieren ebenfalls mehrere Statements:

```powershell
node cli/zeus.js write-sql --profile dev --sql "INSERT INTO APP.T (ID) VALUES (1); UPDATE APP.T SET STATUS='Y' WHERE ID=1" --confirm
```

Jedes Statement wird gegen den Modus geprüft (`insert` nur `INSERT`, `update` nur `UPDATE`,
`write-sql`/`upsert` `INSERT|UPDATE|DELETE|MERGE`). Preflight-Row-Counts und Backups laufen
pro Statement. Produktionsprofile bleiben blockiert.

---

## 3. Wo landen die gefetchten Sourcen?

`fetch` legt die Member deterministisch nach folgendem Schema ab:

```text
<Local destination>/<SOURCE-FILE>/<MEMBER>.<ext>
```

Beispiel nach `fetch --out ./rpg_sources --source-lib APPLIB --source-files QRPGLESRC,QCPYSRC`:

```text
./rpg_sources/
  QRPGLESRC/
    ORDERPGM.rpgle
    CUSTSRV.rpgle
  QCPYSRC/
    SHARED.cpy
  zeus-import-manifest.json     <- Provenienz + Validierung (Herkunft, Checksummen, CCSID)
```

**Endungs-Zuordnung:** `QRPGLESRC→.rpgle`, `QSQLRPGLESRC→.sqlrpgle`, `QRPGSRC→.rpg`,
`QCLSRC→.clp`, `QCLLESRC→.clle`, `QCPYSRC→.cpy`, `QDDSSRC→.dds`, sonst `.src`.

Der `fetch`-Lauf gibt am Ende „Local destination", die Ablage-Struktur und den Pfad zum
Import-Manifest aus. Für die anschließende Analyse gilt das Ausgabeverzeichnis als
`--source`:

```powershell
node cli/zeus.js analyze --source ./rpg_sources --member ORDERPGM --profile dev
```

**Überblick über alle aufgelösten Ressourcen** (Source / Objects / Metadata / Data pro System):

```powershell
node cli/zeus.js resources --profile <name>       # ASCII-Tabelle (ohne Secrets)
node cli/zeus.js doctor --profile <name> --show-resolved
```
