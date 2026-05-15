# Runtime Config Refactoring Plan (Konsolidiert, Stand: 2026-05-15)

## Kontext

Zentrales Runtime-Config-System: `src/config/runtimeConfig.js`.

Die Datei ist produktiv stabil, bündelt aber zu viele Verantwortlichkeiten.  
Ziel ist eine risikoarme, verhaltensgleiche interne Modularisierung bei stabiler öffentlicher API.

## Zentrale Annahme

`runtimeConfig.js` ist keine reine Utility-Datei, sondern:

- Runtime Composition Layer
- Config Resolution Layer
- Policy-/Override-System
- Workflow-/Profile-Resolver
- Runtime Contract Boundary

Deshalb gelten:

- kein Big-Bang-Refactor
- kein API-Redesign
- keine Verhaltensänderung
- keine Clean-Rewrite-Strategie

## Nicht verhandelbare Semantik

Folgendes darf nicht geändert werden:

1. Resolve-/Override-Priorität: CLI > ENV > Profile > Defaults
2. Overlay-/Merge-Reihenfolge
3. `extends`-Inheritance-Verhalten
4. Fehlertext-Grundstruktur, insbesondere `Invalid configuration: ...`
5. DB-Rollen-Fallbacklogik (`db`, `dbRoles.metadata`, `dbRoles.testData`, ENV-Overrides)
6. Priorität von `config/local-only/profiles.json`
7. Öffentliche Exportnamen und Signaturen von `runtimeConfig.js`

## Wichtige Risiken

- implizite Runtime-Verträge
- Fehlertexte als Test-/UX-Vertrag
- Merge-Semantik
- Overlay-Reihenfolge
- Env-Interpolation
- Rückgabeformen der `resolve*Config`-Funktionen

## Verbotene Änderungen

- komplette Datei neu schreiben
- Public API redesignen
- Exporte entfernen
- Dateiformate ändern
- unnötige neue Abstraktionslayer
- bestehende Defaults umbenennen
- Resolver zusammenführen (wenn dabei Verhaltensrisiko steigt)
- Tests so ändern, dass Verhaltensänderungen „akzeptiert“ werden

## Status: Bisher umgesetzt

### Phase 1 – Test-Härtung (abgeschlossen)

Ergänzt/abgesichert in `tests/runtime-config.test.js`:

- Overlay-Reihenfolge
- JSON-Datei-Pfadmodus bei `--config`
- `resolveBundleConfig` Positivfall
- `validateProfiles` als öffentliche API
- `extends`-Zyklen
- Workflow-Normalisierung
- Env-Placeholder-Kantenfälle
- Array-/Merge-Verhalten
- `null` vs `undefined`

Verifikation:

- `node --test tests/runtime-config.test.js` grün
- `npm test` vollständig grün

### Phase 2 – Interne Extraktionen (laufend)

Bereits extrahiert:

- `src/config/runtimeConfigDefaults.js`
- `src/config/runtimeConfigValidation.js`
- `src/config/runtimeConfigProfiles.js`
- `src/config/runtimeConfigWorkflow.js`

`src/config/runtimeConfig.js` bleibt zentrale Fassade mit stabilen Exporten.

## Nächste Schritte (isoliert und klein)

### Schritt A: Resolver-Extraktion (`runtimeConfigResolver.js`)

Umfang:

- `resolveAnalyzeConfig`
- `resolveFetchConfig`
- `resolveBundleConfig`
- ggf. zugehörige DB-Rollen-Helfer (`resolveAnalyzeDbRoleConfigs`, `buildAnalyzeConnectionRoles`, `resolveAnalyzeDbConfig`) nur wenn klein und risikofrei

Schutz:

- Priorität CLI > ENV > Profile > Defaults unverändert
- DB-Rollen-Fallback unverändert
- Rückgabeformen/Feldnamen unverändert

### Schritt B: Env-/Parsing-Helfer (`runtimeConfigEnv.js`)

Umfang:

- `resolveEnvPlaceholdersDeep`
- `parseBoolean`
- `parseCsv`
- `applyDbEnvOverrides`

Schutz:

- Placeholder-Semantik exakt gleich (`${env:...}`, fehlende Werte -> leerer String)
- keine Änderung der Merge-/Overlay-Semantik

### Schritt C: Core-Merge-Helfer (`runtimeConfigCore.js` o. ä.)

Umfang:

- `mergeConfigLayers`
- ggf. weitere kleine pure Helper

Nur umsetzen, wenn der Schritt isoliert und verhaltensgleich bleibt.

## Arbeitsmodus je Schritt

Vor Änderung:

1. `git status`
2. Branch prüfen
3. relevante Tests/Call-Sites prüfen

Nach Änderung:

1. `node --test tests/runtime-config.test.js`
2. `npm test`
3. kurze Risikoanalyse dokumentieren

## PR-/Commit-Schnitt

Ein logischer Refactor-Schritt pro PR/Commit:

1. nur Tests
2. nur Defaults
3. nur Validation
4. nur Profiles
5. nur Workflow
6. nur Resolver
7. nur Env/Core

## Erwartetes Ergebnis

- API bleibt stabil
- Verhalten bleibt identisch
- interne Struktur wird klarer
- Refactoring-Risiko sinkt
- zukünftige Änderungen werden sicherer

Stabilität hat Vorrang vor Architekturästhetik.
