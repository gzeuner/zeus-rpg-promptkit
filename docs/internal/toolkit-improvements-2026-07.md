# Toolkit-Verbesserungen — Juli 2026

Diese Datei dokumentiert die im Juli 2026 umgesetzten Verbesserungen am Zeus RPG PromptKit
sowie die bewusst noch **offenen Punkte**. Stand: **2026-07-03**.

Teststand nach Abschluss: **`npm test` grün — 562 Tests** (contract 13, smoke 4, corpus 1,
unit 544 / 102 Dateien).

---

## 1. Sicherheit

### 1.1 Passwörter verschlüsselt ablegen (Secret Vault)
Passwörter müssen nicht mehr im Klartext in `.env`-Dateien oder Profilen stehen.

- Neues Modul [`src/security/secretVault.js`](../../src/security/secretVault.js): AES-256-GCM,
  Wertformat `enc:v1:<base64>`.
- Schlüssel-Quelle: Umgebungsvariable `ZEUS_SECRET_KEY` (Vorrang) **oder** Datei
  `config/local-only/.zeus-key` (gitignoriert).
- Neuer Befehl `zeus secret <init-key|status|encrypt|decrypt>`
  ([`src/cli/commands/secretCommand.js`](../../src/cli/commands/secretCommand.js)).
- **Transparente Entschlüsselung** in der Env-Platzhalter-Auflösung
  ([`runtimeConfigEnv.js`](../../src/config/runtimeConfigEnv.js)): `enc:v1:`-Werte (im Profil
  oder via `${env:…}`) werden zur Laufzeit automatisch entschlüsselt. Fehlt der Schlüssel,
  schlägt es bewusst **laut** fehl.
- **Env-Override-Pfad** ([`dbRuntimeConfigDiagnostics.js`](../../src/config/dbRuntimeConfigDiagnostics.js),
  `getEnvOverride`) und Fetch-Passwort ([`runtimeConfigResolver.js`](../../src/config/runtimeConfigResolver.js))
  entschlüsseln jetzt ebenfalls — d. h. `ZEUS_DB_PASSWORD=enc:v1:…` direkt in der `.env`
  funktioniert.
- `doctor` zeigt einen **Secret-Vault-Check**.
- Anleitung: [`docs/quickstart/secrets-and-overrides.md`](../quickstart/secrets-and-overrides.md).

### 1.2 Passwörter nicht mehr in der Prozess-Argumentliste
Zuvor wurde das Passwort als positionales CLI-Argument an die Java-Helfer übergeben und war
damit in der OS-Prozessliste sichtbar. Jetzt:

- Neue [`java/ZeusSecrets.java`](../../java/ZeusSecrets.java): löst einen Sentinel
  `@ZEUS_SECRET_ENV@` gegen die Umgebungsvariable `ZEUS_JV_PASSWORD` auf.
- `runJavaClass` ([`javaRuntime.js`](../../src/java/javaRuntime.js)) nimmt eine `password`-Option
  und übergibt sie **über die Umgebung** an den JVM-Child, nicht mehr in `argv`.
- Umgestellt: **alle 10 Java-Helfer** (`Db2DiagnosticQueryRunner`, `Db2WriteQueryRunner`,
  `Db2MetadataExporter`, `Db2ExternalObjectResolver`, `Db2TestDataExtractor`,
  `IbmiCommandRunner`, `IbmiMemberLister`, `IbmiSourceMemberExporter`, `IbmiIfsDownloader`,
  `IbmiSourceSearcher`) sowie alle Node-Aufrufer (readOnly/write query, metadata/testdata
  export, jt400 command/download, field-xref, diagnostic-pack).
- **Live verifiziert** auf DERSMP1 (read-only `SELECT 1` mit Sentinel in `argv`).
- Regressionstest in [`tests/read-only-query-service.test.js`](../../tests/read-only-query-service.test.js).

---

## 2. CLI-Overrides (Bibliothek / Datei / Schema)
Profilwerte lassen sich jederzeit per CLI übersteuern (Vorrang: `args > env > profile`).

- `analyze`: neue Overrides `--schema`, `--library` (Alias `--lib`), `--source-root`
  ([`runtimeConfigResolver.js`](../../src/config/runtimeConfigResolver.js)).
- `query-table`: `--library` als Alias für `--schema` (auf IBM i ist Library = SQL-Schema)
  ([`queryService.js`](../../src/core/queryService.js)).
- `fetch`: bereits vorhanden — `--source-lib`, `--source-files`, `--members` u. a.

---

## 3. Nachvollziehbarkeit der Source-Ablage
- `fetch` gibt am Ende die **Ablage-Struktur** aus
  (`<Local destination>/<SOURCE-FILE>/<MEMBER>.<ext>`) plus konkretes Beispiel und passenden
  `analyze`-Aufruf ([`fetchCommand.js`](../../src/cli/commands/fetchCommand.js)).
- Referenz-Doku [`docs/quickstart/secrets-and-overrides.md`](../quickstart/secrets-and-overrides.md)
  erklärt Ablage, Endungs-Mapping und `resources`/`doctor`-Übersichten.

---

## 4. Test-Infrastruktur
- **Glob-basierter, hermetischer Runner** [`scripts/run-tests.js`](../../scripts/run-tests.js):
  `--unit` findet automatisch alle `tests/*.test.js` (vorher lief nur eine kuratierte,
  unvollständige Liste — **~53 von 113 Dateien**; jetzt **102**). Neue Tests laufen ohne
  manuelle Registrierung mit.
- **Hermetisch by default**: `ZEUS_*`-Variablen werden vor dem Lauf entfernt, damit
  dot-gesourcte Credentials keine Fixtures korrumpieren (Opt-out `ZEUS_TEST_KEEP_ENV=1`).
- Alle `test:*`-Skripte laufen über diesen Runner.
- **Doppelte Keys** in `package.json` (`test:contract/smoke/corpus/benchmark`) entfernt, die
  per JSON-„last-wins" still die neuen Skripte überschrieben.

### 4.1 Reparierte, zuvor tote Tests
Diese Tests waren in keinem npm-Skript verdrahtet und schlugen fehl:
- `qa-report-generator`, `qa-stage-registry`, `qa-stage-runner`: falscher `require`-Pfad
  (`../../src` → `../src`) und fehlender `describe`/`it`-Import aus `node:test`.
- `fixture-sanitization`: Widerspruch — der sanitized-corpus enthielt die verbotenen
  Demo-Namen (`ORDERS`/`INVPGM`). Neutralisiert zu `WRKTBL`/`SUBPGM` (Fixture **und**
  erwartetes `core-patterns.json`, das `scanner-corpus` konsumiert).

---

## 5. Weitere Fehlerbehebungen
- `zeus delete` lief in einen `ReferenceError` (`runDeleteSql` nicht importiert) —
  Import ergänzt ([`cli/zeus.js`](../../cli/zeus.js)).
- **mcp Windows-Kurzpfad (8.3)**: `resolvePathForBoundary`
  ([`src/mcp/mcpTools.js`](../../src/mcp/mcpTools.js)) kanonisiert jetzt den nächsten
  existierenden Elternpfad, sodass die Workspace-Root-Prüfung für noch nicht angelegte
  Ausgabepfade korrekt greift.

---

## Offene Punkte

### O-1: Durchgängiges `--json` auf allen Kommandos (umgesetzt)
**Priorität: mittel.** Global normalization in `cli/zeus.js` (`normalizeJsonArgs`) sorgt dafür, dass
`--json`, `--format json`, `--output json` und `--json-output` einheitlich zu `args.json` führen.

- Gemeinsamer Helper `src/cli/helpers/jsonOutput.js` (mit Secret-Masking via `sanitizeValue`, pretty/compact, deterministisch).
- Viele Commands (analyze, workflow, bundle, impact, query-*, resources, discover, bridge, doctor, profiles, joblog, ... ) unterstützen jetzt `--json` für maschinenlesbare Ausgabe.
- Vertragstest in `tests/json-output-helper.test.js` (inkl. Top-Level Normalization Contract).
- Tool-Catalog und Help-Texte aktualisiert.

Offen: restliche Commands bei Bedarf erweitern, Docs/Beispiele weiter konsolidieren.

### O-2: Override-Konsistenz vervollständigen (klein)
`--library` ist für `analyze` und `query-table` vorhanden; für `write-sql`/`insert`/`update`/
`delete` und ggf. `resolve-object` fehlt ein einheitlicher `--library`/`--schema`-Override
noch (dort teils über `--default-schema`/`--schema` abgedeckt). Angleichung wäre sinnvoll.

### O-3: Java-Passwort auch über stdin (optional, gering)
Der Passwort-Übergabeweg nutzt jetzt eine Umgebungsvariable des Child-Prozesses (nicht mehr
`argv`). Env-Variablen sind auf POSIX via `/proc/<pid>/environ` für denselben Nutzer noch
lesbar. Für maximale Härtung könnte das Passwort alternativ über **stdin** an die Java-Helfer
gereicht werden. Aktuell bewusst zurückgestellt (Aufwand/Nutzen).
