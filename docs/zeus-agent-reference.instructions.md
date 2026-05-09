---
applyTo: "zeus-rpg-promptkit/**"
---

# zeus-rpg-promptkit — Agent-Prompt & Implementierungsreferenz

Du bist ein erfahrener IBM i / Node.js-Entwickler und arbeitest am Tool
`zeus-rpg-promptkit`. Dieses Dokument beschreibt alle relevanten Muster,
Fallbacks, Best Practices und Implementierungshinweise für wiederkehrende
Aufgaben mit dem Tool.

---

## 1. Tool-Architektur (Überblick)

```
zeus-rpg-promptkit/
  cli/
    zeus.js                  ← Entry Point, Command-Router
  src/
    cli/commands/            ← Ein File pro Command
    cli/helpers/             ← asciiTable, etc.
    config/                  ← runtimeConfig, Profile-Auflösung
    db2/
      db2Config.js           ← isDbConfigured, resolveDefaultSchema
      readOnlyQueryService.js ← runReadOnlyDb2Query, validateSqlIdentifier,
                                 escapeSqlLiteral, validateReadOnlySql
    fetch/
      jt400CommandRunner.js  ← runJavaHelper (JDBC + SFTP via jt400)
  config/
    profiles.json            ← Profil-Definitionen
    profiles.example.json    ← Vorlage mit Kommentaren
```

**Aufruf:** `zeus <command> --profile <name> [optionen]`
**Profile werden aufgelöst über:**
1. `ZEUS_CONFIG_DIR` Env-Var
2. `--config <pfad>` CLI-Flag
3. `process.cwd()/config/` (Fallback)

---

## 2. Profile — Generisches Muster (Env-Var-First)

Keine hardcodierten Pfade oder Credentials in `profiles.json`.
Alles über Env-Vars, pro Ticket per Shell-Session setzen.

```json
{
  "default-shared": {
    "outputRoot": "${env:ZEUS_OUTPUT_ROOT}",
    "extensions": [".rpgle", ".sqlrpgle", ".clle", ".clp", ".dds",
                   ".pf", ".lf", ".bnd", ".cpy"],
    "db": {
      "host":           "${env:ZEUS_DB_HOST}",
      "url":            "${env:ZEUS_DB_URL}",
      "user":           "${env:ZEUS_DB_USER}",
      "password":       "${env:ZEUS_DB_PASSWORD}",
      "defaultLibrary": "${env:ZEUS_DB_DEFAULT_LIBRARY}",
      "defaultSchema":  "${env:ZEUS_DB_DEFAULT_SCHEMA}"
    }
  },
  "default-fetch": {
    "extends": "default-shared",
    "fetch": {
      "host":             "${env:ZEUS_FETCH_HOST}",
      "user":             "${env:ZEUS_FETCH_USER}",
      "password":         "${env:ZEUS_FETCH_PASSWORD}",
      "sourceLib":        "${env:ZEUS_FETCH_SOURCE_LIB}",
      "ifsDir":           "${env:ZEUS_FETCH_IFS_DIR}",
      "out":              "${env:ZEUS_FETCH_OUT}",
      "files":            ["QRPGLESRC","QCPYSRC","QCLSRC","QCLLESRC",
                           "QSRVSRC","QSQLSRC","SQLTBLSRC"],
      "streamFileCcsid":  1208,
      "replace":          true,
      "transport":        "auto"
    }
  },
  "default-local": {
    "extends": "default-shared",
    "sourceRoot": "${env:ZEUS_SOURCE_ROOT}"
  }
}
```

### Env-Var Referenz (vollständig)

```
ZEUS_DB_HOST              IBM i DB2 Hostname
ZEUS_DB_URL               JDBC URL (überschreibt HOST wenn gesetzt)
ZEUS_DB_USER              DB2 Benutzername
ZEUS_DB_PASSWORD          DB2 Passwort
ZEUS_DB_DEFAULT_LIBRARY   Default Library  (z.B. APPDATA)
ZEUS_DB_DEFAULT_SCHEMA    Default Schema   (z.B. APPDATA)
ZEUS_FETCH_HOST           IBM i SSH/FTP Host
ZEUS_FETCH_USER           Fetch-Benutzername
ZEUS_FETCH_PASSWORD       Fetch-Passwort
ZEUS_FETCH_SOURCE_LIB     Source Library   (z.B. SOURCEN)
ZEUS_FETCH_IFS_DIR        IFS Basis-Pfad für Stream-Files
ZEUS_FETCH_OUT            Lokales Fetch-Zielverzeichnis
ZEUS_OUTPUT_ROOT          Lokales Analyse-Ausgabeverzeichnis
ZEUS_SOURCE_ROOT          Lokales Quellcode-Arbeitsverzeichnis
```

**`zeus doctor` soll alle Vars prüfen und bei fehlenden einen konkreten
`set`-Befehl ausgeben:**
```
[FAIL] ZEUS_DB_HOST nicht gesetzt → set ZEUS_DB_HOST=mein-ibmi-host
```

---

## 3. Datenabfragen — Patterns & Fallbacks

### 3.1 `query-table` — Tabellenstruktur

```
zeus query-table --profile default-fetch --schema APPDATA --table MEINE_TABELLE
zeus query-table --profile default-fetch --schema APPDATA --table MEINE_TABELLE --filter "PREIS%"
```

**Implementierungshinweise:**
- `SELECT TABLE_SCHEMA, TABLE_NAME FROM QSYS2.SYSTABLES` — **kein ROW_COUNT**,
  weder `ROW_COUNT` noch `NUMBER_ROWS` sind auf allen IBM i Releases vorhanden
- `SELECT ... FROM QSYS2.SYSCOLUMNS WHERE TABLE_NAME = ... ORDER BY ORDINAL_POSITION`
- `--filter` Pattern immer zu Uppercase normalisieren vor Übergabe an SQL LIKE

### 3.2 `query-sql` — Freie Read-Only Abfrage

```
zeus query-sql --profile default-fetch --sql "SELECT ..." [--max-rows 200] [--output csv]
```

**Implementierungshinweise:**
- Nur SELECT/WITH erlaubt (`validateReadOnlySql`)
- Spaltenbreite in ASCII-Tabelle auf **max. 40 Zeichen** begrenzen
- Bei leerem Ergebnis: SQL-Text + `0 row(s) returned` ausgeben
- `--output csv` für Excel-Export: Header + Zeilen kommasepariert
- `--max-rows` Default: 200 (nicht 50 — IBM i Tabellen sind groß)

### 3.3 Schema-Discovery — Automatisch die richtige Bibliothek finden

Wenn das Schema unbekannt ist, nie raten — automatisch suchen:

```javascript
async function discoverSchema(dbConfig, tableName) {
  const result = await runReadOnlyDb2Query({
    dbConfig,
    query: `SELECT TABLE_SCHEMA FROM QSYS2.SYSTABLES
            WHERE TABLE_NAME = ${escapeSqlLiteral(tableName)}
            ORDER BY TABLE_SCHEMA`,
    maxRows: 20,
  });
  // Präferenz-Reihenfolge: Produktions-Schemas zuerst
  const preferred = ['APPDATA', 'PRODLIB', 'DATEN', 'PROD'];
  return (
    result.rows.find(r => preferred.includes(r.TABLE_SCHEMA?.toUpperCase()))
    ?? result.rows[0]
    ?? null
  );
}
```

### 3.4 Column-Alias-Auflösung — SQL0206 vermeiden

IBM i Tabellen haben historisch gewachsene, kurze Spaltennamen.
Vor jeder Abfrage Spaltenname gegen `SYSCOLUMNS` validieren:

```javascript
const COLUMN_ALIASES = {
  // Zentraler Schlüssel → mögliche IBM-i-Varianten
  APP_YEAR:   ['APP_YEAR', 'P_YEAR',   'X_YEAR',   'APP_YEAR_ALT'],
  APP_NUMBER: ['APP_NUMBER','P_NUMBER', 'X_NUMBER', 'APP_NR'],
  DAN:         ['INTERNAL_ITEM_ID', 'P_ITEM_ID', 'X_ITEM_ID', 'ITEM_ID', 'DAN'],
  VKST:        ['LOCATION_ID', 'P_LOCATION', 'LOCATION', 'LOCATION_NR'],
  PREIS:       ['APP_SALE_PRICE', 'P_PRICE', 'RECORDED_PRICE', 'SALE_PRICE'],
  TIMESTAMP:   ['CHANGE_TIMESTAMP', 'X_TIMESTAMP', 'LAST_CHANGE'],
};

async function resolveColumn(dbConfig, schema, table, logicalName) {
  const candidates = COLUMN_ALIASES[logicalName] ?? [logicalName];
  const cols = await getActualColumns(dbConfig, schema, table);
  return candidates.find(c =>
    cols.some(a => a.toUpperCase() === c.toUpperCase())
  ) ?? null;
}
```

### 3.5 Metadaten-Abfragen (Katalog)

**Alle Tabellen in einem Schema:**
```sql
SELECT TABLE_NAME, TABLE_TYPE
FROM QSYS2.SYSTABLES
WHERE TABLE_SCHEMA = 'MEINSCHEMA'
ORDER BY TABLE_NAME;
```

**Spalten mit Preis/Datum/User-Bezug in einem Schema:**
```sql
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH
FROM QSYS2.SYSCOLUMNS
WHERE TABLE_SCHEMA = 'MEINSCHEMA'
  AND (COLUMN_NAME LIKE '%PREIS%'
    OR COLUMN_NAME LIKE '%USER%'
    OR COLUMN_NAME LIKE '%TIME%'
    OR COLUMN_NAME LIKE '%DATUM%')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

**Stored Procedures / Functions:**
```sql
SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE, EXTERNAL_NAME
FROM QSYS2.SYSROUTINES
WHERE ROUTINE_NAME LIKE '%MEINNAME%'
ORDER BY ROUTINE_SCHEMA;
```

**Function-Parameter:**
```sql
SELECT PARAMETER_NAME, DATA_TYPE, PARAMETER_MODE, ORDINAL_POSITION
FROM QSYS2.SYSPARMS
WHERE SPECIFIC_SCHEMA = 'MEINSCHEMA'
  AND SPECIFIC_NAME LIKE '%MEINNAME%'
ORDER BY SPECIFIC_NAME, ORDINAL_POSITION;
```

---

## 4. Source-Code-Download — Patterns & Fallbacks

### 4.1 Transport: SFTP bevorzugen

SFTP ist performant und zuverlässig für IBM i IFS-Zugriff.
`transport: "auto"` wählt automatisch SFTP wenn verfügbar.
Für explizite Kontrolle:

```json
"transport": "sftp"   ← bevorzugt, schnellste Option
"transport": "jt400"  ← Fallback via JDBC/jt400
"transport": "ftp"    ← letzter Fallback
"transport": "auto"   ← automatisch (empfohlen)
```

### 4.2 Source-File-Discovery — Member in unbekannter Source-Datei finden

Nie annehmen dass ein Member in `QRPGLESRC` liegt. Reihenfolge:

```javascript
const SOURCE_FILES_PRIORITY = [
  'QRPGLESRC',  // RPG Free + Fixed
  'QSRVSRC',    // Service-Programm Binder Source
  'QCPYSRC',    // Copy-Books / Prototypen
  'QCLLESRC',   // CL-Programme (modern)
  'QCLSRC',     // CL-Programme (klassisch)
  'QSQLSRC',    // Embedded SQL
  'SQLTBLSRC',  // SQL Table DDL
  'SQLVIEWSRC', // SQL Views
  'SQLIDXSRC',  // SQL Indexes
  'FORMSRC',    // Forms
  'QDDSSRC',    // DDS (Screens, PFs, LFs)
];

async function discoverMember(fetchConfig, memberName) {
  for (const file of SOURCE_FILES_PRIORITY) {
    try {
      const result = await fetchSingle(fetchConfig, file, memberName);
      if (result.success) return { file, result };
    } catch { continue; }
  }
  return null; // nicht gefunden — nicht als Fehler behandeln
}
```

### 4.3 Service-Programm-Bibliothek via QSYS2 finden

Nie hardcoden in welcher Lib ein Service-Programm liegt:

```sql
-- Schritt 1: Wo liegt das kompilierte Objekt?
SELECT OBJNAME, OBJLIB, OBJCREATED
FROM TABLE(QSYS2.OBJECT_STATISTICS('*ALLUSR', '*SRVPGM', 'MEIN_SV')) AS X;

-- Schritt 2: Welche Module sind eingebunden + wo liegt der Source?
SELECT BOUND_MODULE, BOUND_MODULE_LIBRARY,
       SOURCE_FILE_LIBRARY, SOURCE_FILE, SOURCE_FILE_MEMBER
FROM QSYS2.BOUND_MODULE_INFO
WHERE PROGRAM_LIBRARY = 'GEFUNDENE_LIB'
  AND PROGRAM_NAME    = 'MEIN_SV';
```

**Fallback wenn BOUND_MODULE_INFO leer:**
- Versuch 1: Member-Name = Service-Programm-Name (häufigste Konvention)
- Versuch 2: `SOURCE_FILES_PRIORITY` Liste mit memberName durchlaufen

```javascript
async function discoverModuleSource(dbConfig, fetchConfig, srvpgmName, srvpgmLib) {
  // Versuch 1: BOUND_MODULE_INFO
  const bound = await queryBoundModules(dbConfig, srvpgmLib, srvpgmName);
  if (bound.length > 0) return bound;

  // Versuch 2: Konvention Member = SRVPGM-Name
  const found = await discoverMember(fetchConfig, srvpgmName);
  if (found) return [{ SOURCE_FILE: found.file, SOURCE_FILE_MEMBER: srvpgmName }];

  return [];
}
```

### 4.4 Fetch-Kommando Best Practices

```
# Nur bestimmte Member holen (schneller als alles)
zeus fetch --profile default-fetch --members PROG1,PROG2,COPY1 --replace true

# Nur bestimmte Source-Files durchsuchen
zeus fetch --profile default-fetch --members PROG1 --files QRPGLESRC,QCPYSRC

# Kompletten Source-Tree (langsam, nur für erste Einrichtung)
zeus fetch --profile default-fetch --replace true
```

**Hinweis:** `--replace true` immer setzen wenn man den aktuellen Stand
vom Host will. Ohne `--replace` werden vorhandene Dateien nicht überschrieben.

---

## 5. Analyse-Kommandos

### 5.1 `zeus analyze`

```
zeus analyze --profile default-local --mode documentation --member MEINPGM
zeus analyze --profile default-local --mode defect-analysis --member MEINPGM
zeus analyze --profile default-local --mode error-analysis --member MEINPGM
```

**Token-Budget:** Für große RPG-Dateien (>1500 Zeilen) `tokenBudget` im Profil
auf 4000–6000 setzen:

```json
"tokenBudget": {
  "documentation":   4000,
  "defect-analysis": 4000,
  "error-analysis":  4000
}
```

### 5.2 `zeus impact`

```
zeus impact --profile default-local --member MEINPGM --field MEINFELD
```

Analysiert Feldverwendung über Programm-Grenzen hinweg. Nützlich um Scope
einer Änderung abzusichern.

### 5.3 `zeus diff`

```
zeus diff --profile default-local --member MEINPGM
```

Vergleicht Fetch-Original mit lokaler Arbeitskopie. Immer vor Deployment-Übergabe ausführen.

---

## 6. AUTOMATIC Mode — Implementierungsmuster

### 6.1 Prinzip: Discover → Validate → Execute → Fallback

```javascript
async function autoQuery(dbConfig, logicalTableName, logicalColumns, filter) {
  // 1. Schema entdecken
  const schema = await discoverSchema(dbConfig, logicalTableName);
  if (!schema) throw new Error(`Tabelle ${logicalTableName} nicht gefunden`);

  // 2. Spalten auflösen
  const resolved = await Promise.all(
    logicalColumns.map(col => resolveColumn(dbConfig, schema, logicalTableName, col))
  );
  const validCols = resolved.filter(Boolean);

  // 3. Query bauen + ausführen
  const query = buildQuery(schema, logicalTableName, validCols, filter);
  return runReadOnlyDb2Query({ dbConfig, query, maxRows: 200 });
}
```

### 6.2 Fehlerbehandlung nach SQL-State

```javascript
const SQL_RETRY_STRATEGIES = {
  'SQL0206': 'column_not_found',    // Spalte fehlt → Column-Alias-Fallback
  'SQL0204': 'table_not_found',     // Tabelle fehlt → Schema-Discovery
  'SQL0551': 'no_auth',             // Keine Berechtigung → anderes Schema probieren
  'SQL0901': 'system_error',        // Systemfehler → einmal retry, dann abbrechen
};

async function executeWithFallback(dbConfig, query, context) {
  try {
    return await runReadOnlyDb2Query({ dbConfig, query, maxRows: 200 });
  } catch (err) {
    const strategy = SQL_RETRY_STRATEGIES[extractSqlState(err)];
    if (strategy === 'column_not_found') {
      return await retryWithColumnFallback(dbConfig, query, context);
    }
    if (strategy === 'table_not_found') {
      return await retryWithSchemaDiscovery(dbConfig, query, context);
    }
    throw err;
  }
}
```

### 6.3 Logging-Pattern für automatische Abläufe

```javascript
function logStep(step, status, detail = '') {
  const icon = { ok: '✓', warn: '⚠', fail: '✗', info: '→' }[status];
  console.log(`  ${icon} [${step}] ${detail}`);
}

// Nutzung:
logStep('schema-discovery', 'ok',   'APPVIEW_00 → APPDATA');
logStep('column-resolve',   'warn', 'APP_YEAR nicht direkt → P_YEAR (alias)');
logStep('fetch',            'fail', 'QRPGLESRC/APPSRV_SV nicht gefunden');
logStep('fetch',            'ok',   'QSRVSRC/APPSRV_SV gefunden (fallback)');
```

---

## 7. ASCII-Tabellen & Output

### 7.1 Spaltenbreiten-Limit

Lange VARCHAR-Felder (z.B. Fehlertext, Beschreibung) brechen das Layout.
Immer kürzen:

```javascript
function truncateCell(value, maxLen = 40) {
  const str = String(value ?? '');
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}
```

### 7.2 CSV-Output für Ticket-Arbeit

```javascript
function renderCsv(columns, rows) {
  const header = columns.join(';');
  const lines = rows.map(row =>
    columns.map(col => `"${String(row[col] ?? '').replace(/"/g, '""')}"`).join(';')
  );
  return [header, ...lines].join('\n');
}
```

---

## 8. IBM i Spezifika — Bekannte Fallstricke

| Problem | Symptom | Lösung |
|---|---|---|
| `ROW_COUNT` fehlt in SYSTABLES | SQL0206 | Spalte weglassen |
| `NUMBER_ROWS` auch nicht überall | SQL0206 | Spalte weglassen |
| Tabelle in unerwarteter Bibliothek | SQL0204 / leere Ergebnisse | Schema-Discovery via SYSTABLES |
| Service-Programm Lib ≠ Schema | BOUND_MODULE_INFO leer | OBJECT_STATISTICS über `*ALLUSR` |
| Source-Member in QSRVSRC statt QRPGLESRC | Export failed | SOURCE_FILES_PRIORITY Liste |
| Spaltennamen variieren (P_YEAR vs APP_YEAR) | SQL0206 | COLUMN_ALIASES + resolveColumn |
| CCSID-Probleme bei Fetch | Umlaute falsch | `streamFileCcsid: 1208` (UTF-8) |
| `.cmd`-Aufruf ohne `call` verlässt Batch | Batch endet nach 1. Aufruf | Immer `call %ZEUS%` |
| `%%` in Batch-Subroutinen | Filter-Parameter zerstört | Kein `call :sub` — Inline-Calls |
| Commitment Control fehlt | SQLSTATE 55019 bei DML | `WITH NC` (nur Read-Only relevant für Diagnose) |
| Schema-Qualifier Syntax | Fehler bei `BIBLIOTHEK/DATEI` | Immer SQL-Syntax: `SCHEMA.TABLE` |

---

## 9. Implementierungs-Reihenfolge für neue Features

Empfohlene Reihenfolge um Abhängigkeiten zu vermeiden:

```
1. src/db2/columnFallback.js     ← COLUMN_ALIASES, resolveColumn, discoverSchema
2. src/db2/schemaDiscovery.js    ← discoverSrvpgmLib, discoverModuleSource
3. src/fetch/memberDiscovery.js  ← discoverMember (SOURCE_FILES_PRIORITY)
4. src/cli/helpers/csvRenderer.js ← renderCsv
5. src/cli/commands/querySqlCommand.js (erweitern) ← --output csv, Spaltenbreite
6. src/cli/commands/doctorCommand.js (erweitern)   ← neue Env-Vars prüfen
7. src/cli/commands/<neuesCommand>.js              ← Haupt-Kommando
8. cli/zeus.js                   ← Command registrieren + --help aktualisieren
9. config/profiles.example.json  ← neue Vars dokumentieren
```

**Grundregeln:**
- Ein Command = eine Datei in `src/cli/commands/`
- Kein direktes `process.exit()` außer im CLI-Entry-Point
- Alle DB2-Abfragen über `runReadOnlyDb2Query` — nie direktes JDBC
- Credentials **nie** in Code oder Config-Dateien — nur Env-Vars
- Fehler immer mit SQL-State + Parameter im Fehlertext loggen
- `validateSqlIdentifier` für alle Tabellen-/Schema-Namen aus User-Input
- `escapeSqlLiteral` für alle Wert-Parameter in SQL-Strings

---

## 10. Qualitätssicherung

### 10.1 `zeus doctor` erweitern

Für jedes neue Feature: Entsprechende Prüfung in `doctorCommand.js` ergänzen.
Ausgabe-Schema:

```
[PASS] Profil 'default-fetch' aufgelöst
[PASS] Java im PATH (Version 17.0.2)
[PASS] jt400.jar gefunden
[PASS] ZEUS_DB_HOST gesetzt
[FAIL] ZEUS_FETCH_OUT nicht gesetzt → set ZEUS_FETCH_OUT=C:/Projekte/ticket/zeus-fetch
[WARN] ZEUS_OUTPUT_ROOT nicht gesetzt → Analyse-Output geht nach ./output/
```

### 10.2 Vor Deployment immer prüfen

```
1. zeus doctor --profile <name>       → Umgebung OK?
2. zeus diff --profile <name> --member <name>  → Nur gewollte Änderungen?
3. Manuelle Übergabe — zeus schreibt NIE auf IBM i
```
