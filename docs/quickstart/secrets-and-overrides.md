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
2. Datei `config/local-only/.zeus-key` (gitignoriert)

> ⚠️ Ohne passenden Schlüssel schlägt die Auflösung eines `enc:v1:`-Werts bewusst **laut**
> fehl (keine stillen Leer-/Falschwerte). Der Schlüssel ist geheim und darf nicht geteilt
> oder eingecheckt werden. Wird der Schlüssel getauscht, müssen alle Werte neu verschlüsselt
> werden.

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

```powershell
node cli/zeus.js fetch --profile dev --source-lib APPLIB --source-files QRPGLESRC,QCPYSRC --members ORDERPGM,CUSTSRV
```

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
