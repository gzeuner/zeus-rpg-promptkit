# Runtime Config Refactoring Plan (2026-05-15)

## Kurzfazit
`src/config/runtimeConfig.js` ist funktional stark und zentral, bündelt aber zu viele Verantwortlichkeiten in einer Datei (1192 Zeilen). Ein Big-Bang-Umbau wäre unnötig riskant, weil viele Commands/Core-Services direkt davon abhängen. Ein sicheres Vorgehen ist: erst API stabilisieren und mit zusätzlichen Tests absichern, danach in sehr kleinen, verhaltensgleichen Schritten intern extrahieren.

## Aktuelle Verantwortlichkeiten
Die Datei vereint aktuell mehrere Schichten:

1. Konstanten und Defaults
- z. B. `DEFAULT_EXTENSIONS`, `DEFAULT_WORK_COPY`, `DEFAULT_TOKEN_BUDGET`, Workflow/Fetch-Defaults.

2. Validierung von Profilstruktur und resolved Config
- strukturelle Validatoren für Profile, Fetch, DB, Workflow, Bridge.
- zentrale Fehlerform über `Invalid configuration: ...`.

3. Parsing/Normalisierung
- bool/csv parsing, Listen-Normalisierung, Key-Alias-Normalisierung (`normalizeTokenBudgetKey`), Workflow-Normalisierung.

4. Merging und Inheritance
- rekursives Layer-Merging (`mergeConfigLayers`), `extends`-Auflösung in `resolveProfile` inkl. Zyklus-Erkennung.

5. Env-Interpolation und Env-Overrides
- `${env:VAR}`-Expansion (`resolveEnvPlaceholdersDeep`).
- DB-Rollen-Overrides (`ZEUS_DB_*`, `ZEUS_METADATA_DB_*`, `ZEUS_TESTDATA_DB_*`).

6. Dateisystem-Laden von Profilen
- Pfadauflösung (`--config`, `ZEUS_CONFIG_DIR`, default `config/`).
- Fallbacks und Overlay-Dateien (`profiles.<name>.json`).
- Metadata-Anreicherung via Symbol.

7. Öffentliche Resolve-APIs
- `resolveAnalyzeConfig`, `resolveFetchConfig`, `resolveBundleConfig`, `resolveAnalyzeDbConfig`, Workflow/Preset-Resolver.

## Öffentliche Exporte / Call-Sites
Exportierte API (aktueller Stand):
- Defaults: `DEFAULT_EXTENSIONS`, `DEFAULT_ANALYSIS_LIMITS`, `DEFAULT_TOKEN_BUDGET`, `DEFAULT_WORK_COPY`, `DEFAULT_WORKFLOW_*`
- Loader/Profile: `resolveProfilesConfigPaths`, `loadProfiles`, `getProfilesMetadata`, `resolveProfile`
- Resolver: `resolveAnalyzeConfig`, `resolveAnalyzeDbConfig`, `resolveFetchConfig`, `resolveBundleConfig`
- Workflow/WorkCopy/Token: `readWorkflowConfig`, `resolveWorkflowPresetConfig`, `readWorkCopyConfig`, `readTokenBudgetConfig`
- Sonstige: `normalizeTokenBudgetKey`, `validateProfiles`, `describeProfilesLocation`

Externe Nutzung (hoch gekuppelt):
- `resolveAnalyzeConfig`: viele Core- und CLI-Pfade (`analyze`, `impact`, `query`, `doctor`, `joblog`, `bridge`, `inspect-object`, `test-run`, ...)
- `loadProfiles` + `resolveProfile`: breit in CLI/Workflow/WorkCopy
- `resolveFetchConfig`: Fetch, Workflow, Diff, Doctor
- `resolveAnalyzeDbConfig`: Analyze-Pipeline, Query, Doctor, Joblog, Upsert, Inspect
- `resolveBundleConfig`: Bundle/Serve/Run-Explorer

Gering oder kaum extern genutzt:
- `ALLOWED_WORK_COPY_EXTENSIONS`, `ALLOWED_WORKFLOW_STEPS`, `describeProfilesLocation`, `normalizeTokenBudgetKey`, `validateProfiles`

## Risiken
1. Sehr hohe seiteneffektbehaftete Kopplung über Fehlertexte
- Tests prüfen teils konkrete Fehlermeldungen per Regex.

2. Kritische Merge-/Resolve-Semantik
- `extends`-Reihenfolge, Array-Override-Verhalten, Overlay-Reihenfolge und Env-Precedence dürfen sich nicht ändern.

3. Implizite Runtime-Verträge
- Commands erwarten bestimmte Feldnamen/Defaults in den resolved Config-Objekten.

4. Pfad-/Datei-Ladeverhalten
- `--config`, `ZEUS_CONFIG_DIR`, `local-only/profiles.json`, `profiles.json`, `profiles.example.json`, Overlay-Dateien.

5. DB-Rollen-Fallbackkette
- `db`, `dbRoles.metadata`, `dbRoles.testData` plus env overrides ist sensibel.

## Bestehende Tests
Direkt:
- `tests/runtime-config.test.js` (574 Zeilen, breiter Kern: load/resolve/validation/fetch/dbRoles/workflow/token/workCopy/error-cases)

Indirekt relevante Absicherung:
- `tests/analyze-governance-config.test.js` (governance/limits/test-data via `resolveAnalyzeConfig`)
- `tests/doctor-command.test.js` (env-check-Logik mit runtime-config-abhängigen Daten)
- weitere CLI/Core Tests hängen implizit an `resolve*`-Verhalten (sichtbar im vollständigen `npm test`)

## Fehlende Tests vor Refactoring
Vor echter Modularisierung sollten zusätzlich abgesichert werden:

1. `loadProfiles` Overlay-Reihenfolge explizit
- deterministische Merge-Reihenfolge mehrerer `profiles.<name>.json`.

2. `resolveProfilesConfigPaths` JSON-Datei-Pfad-Modus
- wenn `--config` direkt auf Datei zeigt (nicht Verzeichnis).

3. `resolveBundleConfig` Positivfall
- derzeit nur Fehlerfall (`unknown profile`) explizit getestet.

4. `validateProfiles` als öffentliche API
- aktuell exportiert, aber nicht direkt getestet.

5. Workflow-Normalisierungskanten
- Duplikate/Case-Normalisierung bei `steps`, `members`, `tables`, `impact`.

6. Env-Placeholder-Kanten
- Placeholder in Arrays/verschachtelten Objekten, leere Env-Werte.

## Empfohlener Zielzuschnitt
Nur Zielbild, noch keine Umsetzung:

1. `src/config/runtimeConfigDefaults.js`
- reine Konstanten/Defaultwerte/Allow-Listen.

2. `src/config/runtimeConfigValidation.js`
- alle `validate*`-Funktionen plus primitive asserts.

3. `src/config/runtimeConfigEnv.js`
- `${env:...}`-Expansion, DB-Env-Overrides, role-spezifische Env-Helfer.

4. `src/config/runtimeConfigProfiles.js`
- Pfadauflösung, Dateiladen, Overlay-Handling, Profile-Metadata, `resolveProfile`.

5. `src/config/runtimeConfigWorkflow.js`
- Workflow-/Preset-Normalisierung und `readWorkflowConfig`/`resolveWorkflowPresetConfig`.

6. `src/config/runtimeConfigResolver.js`
- `resolveAnalyzeConfig`, `resolveFetchConfig`, `resolveBundleConfig`, `resolveAnalyzeDbConfig`.

7. `src/config/runtimeConfig.js` (Fassade)
- stabile Export-Fassade für Backward-Kompatibilität; re-exportiert aus den neuen Modulen.

## Sicherer PR-Plan in 3–6 kleinen Schritten
1. Test-Härtung ohne Refactor
- fehlende Tests ergänzen (oben), keine Produktionslogik ändern.

2. Defaults extrahieren
- `runtimeConfigDefaults.js` einführen, `runtimeConfig.js` nutzt nur importierte Defaults.
- keine Exportänderung an Außenwelt.

3. Validation extrahieren
- `runtimeConfigValidation.js` einführen; `runtimeConfig.js` delegiert.
- Fehlertexte unverändert lassen.

4. Profile-Layer extrahieren
- `resolveProfilesConfigPaths`, `loadProfiles`, `resolveProfile`, Metadata-Helfer auslagern.
- Overlay-/fallback-Verhalten per Tests absichern.

5. Env/Workflow/Resolver extrahieren
- erst Env-Helfer, dann Workflow-Helfer, dann `resolve*Config`.
- `runtimeConfig.js` bleibt stabile Fassade.

6. Optional: API-Aufräumen (separater PR)
- ungenutzte Exporte nur nach Suchlauf + Deprecation-Hinweis entfernen.

## Dinge, die ausdrücklich nicht geändert werden sollten
1. Resolve-Semantik und Prioritäten
- CLI args > Env > Profil > Defaults (in den bestehenden Flows).

2. Sicherheitsrelevante Guardrails
- keine Lockerung bei DB-Role-Override-Logik oder Profilvalidierung.

3. Fehlertext-Grundform
- `Invalid configuration: ...` und zentrale Fehlpfade stabil halten.

4. Datei-/Pfad-Fallbacklogik
- `local-only/profiles.json` Priorität und Overlay-Mechanik beibehalten.

5. Stabile Kernbereiche außerhalb runtime-config
- `src/analyze/stageRegistry.js`
- `src/analyze/runStages.js`
- `src/reproducibility/reproducibility.js`
- `src/db2/readOnlyQueryService.js`

## Empfehlung für den ersten echten Refactoring-Schritt
Als erster echter PR-Schritt: **nur Test-Härtung**.

Konkreter Scope:
1. Ergänze gezielte Tests für Overlay-Reihenfolge, JSON-Datei-Pfadmodus, positiven Bundle-Resolve-Fall und `validateProfiles`.
2. Keine Produktionsänderung an `runtimeConfig.js`.
3. Erst wenn diese Tests grün und stabil sind, mit der Extraktion von Defaults beginnen.
