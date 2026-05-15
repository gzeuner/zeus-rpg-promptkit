# Runtime Config Refactoring Plan (Konsolidiert, Stand: 2026-05-15)

## Kontext

Zentrales Runtime-Config-System:

`src/config/runtimeConfig.js`

Die Datei ist produktiv stabil, bündelt jedoch zu viele Verantwortlichkeiten in einer Datei.

Ziel ist eine risikoarme, verhaltensgleiche interne Modularisierung bei stabiler öffentlicher API.

Die bestehende Laufzeitsemantik gilt als produktionskritisch.

---

# Zentrale Architekturannahme

`runtimeConfig.js` ist keine reine Utility-Datei.

Das Modul fungiert aktuell als:

- Runtime Composition Layer
- Config Resolution Layer
- Policy-/Override-System
- Workflow-/Profile-Resolver
- Runtime Contract Boundary

Deshalb gelten folgende Architekturregeln:

- kein Big-Bang-Refactor
- kein API-Redesign
- keine Verhaltensänderungen
- keine Clean-Rewrite-Strategie
- keine aggressive Abstraktion
- Stabilität vor Architekturästhetik

---

# Nicht verhandelbare Semantik

Folgendes darf NICHT verändert werden:

1. Resolve-/Override-Priorität
- CLI > ENV > Profile > Defaults

2. Overlay-/Merge-Reihenfolge

3. `extends`-Inheritance-Verhalten

4. Fehlertext-Grundstruktur
- insbesondere:
  `Invalid configuration: ...`

5. DB-Rollen-Fallbacklogik
- `db`
- `dbRoles.metadata`
- `dbRoles.testData`
- ENV-Overrides

6. Priorität von:
- `config/local-only/profiles.json`

7. Öffentliche Exportnamen und Signaturen von:
- `runtimeConfig.js`

8. Deterministisches Verhalten identischer Inputs
- gleiche Inputs müssen identische resolved Configs erzeugen

9. Keine stillen Default-Änderungen
- keine neuen impliziten Defaults
- keine geänderten Fallbackwerte
- keine veränderte Behandlung von:
  - `undefined`
  - `null`
  - leeren Arrays
  - fehlenden Keys

---

# Runtime-Config Boundary

`runtimeConfig.js` bleibt die EINZIGE öffentliche Runtime-Config-Fassade.

Neue interne Module dürfen NICHT direkt von:
- CLI-Commands
- Core-Services
- Workflow-Komponenten
- Analyze-Pipelines

verwendet werden.

Erlaubt:
- interne Nutzung innerhalb des Runtime-Config-Subsystems

Nicht erlaubt:
- schleichende externe Direktimporte neuer Teilmodule

Beispiel für VERBOTENE Entwicklung:

```text
CLI -> runtimeConfigProfiles.js
CLI -> runtimeConfigResolver.js
CLI -> runtimeConfigEnv.js
```

Zulässig bleibt ausschließlich:

```text
CLI/Core -> runtimeConfig.js
runtimeConfig.js -> interne Teilmodule
```

---

# Wichtige Risiken

Besonders sensitiv:

- implizite Runtime-Verträge
- Fehlertexte als Test-/UX-Vertrag
- Merge-Semantik
- Overlay-Reihenfolge
- Env-Interpolation
- Rückgabeformen der `resolve*Config`-Funktionen
- implizite Default-Auflösung
- Reihenfolge von Layer-Merges
- DB-Rollen-Auflösung

Verhalten ist wichtiger als „schöne Architektur“.

---

# Verbotene Änderungen

Nicht erlaubt:

- komplette Datei neu schreiben
- Public API redesignen
- Exporte entfernen
- Dateiformate ändern
- unnötige neue Abstraktionslayer
- bestehende Defaults umbenennen
- Resolver zusammenführen, wenn Verhaltensrisiko steigt
- Tests so ändern, dass Verhaltensänderungen „akzeptiert“ werden
- stilles Ändern von Defaults/Fallbacks
- neue globale Seiteneffekte
- neue Runtime-Magie oder implizite Auto-Auflösung

---

# Status: Bereits umgesetzt

## Phase 1 – Test-Härtung (abgeschlossen)

Zusätzlich abgesichert in:

`tests/runtime-config.test.js`

Abgedeckt:

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

- `node --test tests/runtime-config.test.js`
- `npm test`

Beide vollständig grün.

---

## Phase 2 – Interne Extraktionen (aktuell abgeschlossen)

Bereits extrahiert:

- `src/config/runtimeConfigDefaults.js`
- `src/config/runtimeConfigValidation.js`
- `src/config/runtimeConfigProfiles.js`
- `src/config/runtimeConfigWorkflow.js`
- `src/config/runtimeConfigResolver.js`
- `src/config/runtimeConfigEnv.js`
- `src/config/runtimeConfigCore.js`

Wichtig:

`src/config/runtimeConfig.js`
bleibt zentrale stabile Export-Fassade.

Schritt A bis C wurden verhaltensgleich als interne Extraktionen umgesetzt.
Die nachfolgenden Schrittbeschreibungen bleiben als Referenz des umgesetzten Zuschnitts erhalten.

---

# Referenz der umgesetzten Extraktionsschritte

## Schritt A – Resolver-Extraktion

Neue Datei:

`src/config/runtimeConfigResolver.js`

Umfang:

- `resolveAnalyzeConfig`
- `resolveFetchConfig`
- `resolveBundleConfig`

Optional nur wenn klein und risikoarm:

- `resolveAnalyzeDbRoleConfigs`
- `buildAnalyzeConnectionRoles`
- `resolveAnalyzeDbConfig`

Schutzbedingungen:

- CLI > ENV > Profile > Defaults bleibt unverändert
- DB-Rollen-Fallback unverändert
- Rückgabeformen/Feldnamen unverändert
- keine Änderung von Fehlertexten
- keine neuen Defaults

WICHTIG:
Keine funktionalen Verbesserungen während der Extraktion.

Nur:
- Move
- minimale Imports
- minimale Delegation

---

## Schritt B – Env-/Parsing-Helfer

Neue Datei:

`src/config/runtimeConfigEnv.js`

Umfang:

- `resolveEnvPlaceholdersDeep`
- `parseBoolean`
- `parseCsv`
- `applyDbEnvOverrides`

Schutzbedingungen:

- `${env:...}`-Semantik exakt gleich
- fehlende ENV-Werte -> leerer String
- keine Änderung der Merge-/Overlay-Semantik
- keine Änderung der Parsing-Toleranz

---

## Schritt C – Core-Merge-Helfer

Neue Datei:

`src/config/runtimeConfigCore.js`

Möglicher Umfang:

- `mergeConfigLayers`
- kleine pure Helper

Nur umsetzen wenn:

- isoliert
- klein
- verhaltensgleich
- vollständig testabgedeckt

---

# Arbeitsmodus je Refactor-Schritt

## Vor jeder Änderung

Pflicht:

1. `git status`
2. aktuellen Branch prüfen
3. relevante Tests identifizieren
4. relevante Call-Sites prüfen
5. bestehende Runtime-Verträge verstehen

---

## Nach jeder Änderung

Pflicht:

1. `node --test tests/runtime-config.test.js`
2. `npm test`
3. kurze Risikoanalyse dokumentieren

Dokumentieren:

- was geändert wurde
- warum es verhaltensgleich ist
- welche Risiken geprüft wurden
- welche Tests betroffen waren

---

# Commit-/PR-Disziplin

Ein logischer Refactor-Schritt pro PR/Commit.

Erlaubte Schnitte:

1. nur Tests
2. nur Defaults
3. nur Validation
4. nur Profiles
5. nur Workflow
6. nur Resolver
7. nur Env/Core

Nicht erlaubt:

- Misch-PRs
- Architekturumbauten parallel zu Teständerungen
- funktionale Erweiterungen innerhalb von Refactor-PRs

---

# Erwünschte Eigenschaften

Bevorzugen:

- deterministisches Verhalten
- explizite Datenflüsse
- kleine interne Module
- stabile Contracts
- reproduzierbare Runtime-Auflösung
- nachvollziehbare Fehlerbilder
- minimale Seiteneffekte
- geringe Kopplung
- kontrollierte Verantwortlichkeiten

Nicht priorisieren:

- minimale LOC
- maximale DRY-Abstraktion
- „clevere“ Architektur
- unnötige Helper-Schichten
- kosmetische Refactors

---

# Langfristige Architekturidee (NICHT jetzt umsetzen)

Mögliche spätere Richtung:

- immutable resolved runtime snapshot
- serialisierbare Runtime-Auflösung
- explizitere Merge-Policies
- stabilere Error-Codes
- reproduzierbare Runtime-Dumps
- Debug-/Audit-Snapshots

Diese Punkte aktuell NICHT implementieren.

Keine Vorab-Abstraktionen dafür bauen.

---

# Erwartetes Ergebnis

Am Ende soll:

- die öffentliche API stabil bleiben
- das Verhalten identisch bleiben
- die interne Struktur klarer werden
- Refactoring-Risiko sinken
- zukünftige Änderungen sicherer werden
- neue Entwickler schneller Orientierung finden
- Runtime-Verträge expliziter werden

Der wichtigste Erfolgsfaktor ist Stabilität.

Nicht:
- maximale Modernisierung
- maximale Aufteilung
- perfekte Architektur

Das Ziel ist sichere Evolution eines produktiven Runtime-Kerns.
