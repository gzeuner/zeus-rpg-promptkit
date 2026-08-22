<!--
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

# GUI-Zielbild: AI Workbench

Diese Datei ist der fortschreibbare Arbeitsplan für die lokale Zeus-GUI. Nach jeder GUI-Iteration werden der erreichte Stand, die Prüfungen, offene Risiken und das nächste konkrete To-do ergänzt.

## Produktentscheidung

Die GUI ist ein optionaler, lokaler Arbeitsraum über den bestehenden CLI-, API-, MCP-, Workflow- und Evidence-Verträgen. Sie dupliziert keine Command-Logik und führt keine beliebigen Browser-Kommandos aus.

Die zentrale Bedienidee lautet:

> Alle sinnvollen Commands sind auffindbar; prominent sichtbar sind nur die kontextuell passenden nächsten Aktionen.

## Zielbild

### 1. Kontextleiste

Der aktuelle Arbeitskontext bleibt jederzeit sichtbar und steuerbar:

- System
- Bibliothek
- Source-Datei und Member
- Metadaten- und Datenbereich
- aktive Analyse beziehungsweise Run
- Aktualität und letzter Fetch
- Evidence- und Sicherheitsstufe

### 2. Command Palette

Eine zentrale Frage wie „Was möchtest du tun?“. Die Palette wird aus dem Live-Command-Katalog gespeist, ist per Tastatur erreichbar und zeigt sichere, allowlistete Aktionen statt einer flachen Buttonwand.

### 3. Workflows

Geführte, nachvollziehbare Abläufe mit Eingaben, Ergebnissen, Evidence, nächstem Schritt und sichtbaren Freigabepunkten:

- System onboarden
- Source und Metadaten erfassen
- Programm analysieren
- Impact prüfen
- Journaldaten bewerten
- Review-Bundle erzeugen

### 4. Rollenprofile

Editierbare Rollenprofile für Developer, Architect, Tester und Product Owner. Ein Profil bündelt Prompt-Template, bevorzugte Workflows, Tools, Sprache, Ausgabeformat und Sicherheitsniveau.

### 5. Evidence Explorer

Quellenbaum, Evidence-Timeline, Graph-Beziehungen, Aktualitätsstatus und „Warum weiß Zeus das?“-Quellenangaben werden in einem gemeinsamen Arbeitsraum sichtbar.

### 6. Setup- und Profil-Wizard

Profile, Umgebungen, Schlüssel und Routing werden schrittweise angelegt. Secret-Werte bleiben außerhalb von Browser-Antworten, Logs und normalen UI-Ausgaben.

## Sicherheits- und Architekturregeln

- CLI und MCP bleiben die technische Wahrheit.
- Die GUI nutzt nur registrierte Commands und Workflows.
- Keine beliebige Shell-Ausführung aus dem Browser.
- S0/S1-Aktionen dürfen direkt navigieren oder lesen.
- S2 zeigt Scope und Ziel vor Ausführung.
- S3/S4 benötigen explizite Freigabe und eine sichtbare Vorschau.
- Secret-Werte werden nie dargestellt; nur Referenzen, Masken und Status sind erlaubt.
- Jede Aktion erzeugt perspektivisch eine nachvollziehbare Run-Karte mit Status, Ziel, Evidence und Ergebnis.

## Iterationsstand

### Iteration 1 — AI Workbench Foundation

Status: umgesetzt am 2026-08-21; lokale Qualitätsprüfungen grün, PR- und Main-CI werden im Veröffentlichungsdurchlauf verifiziert.

Umgesetzt:

- lebende Roadmap als diese Datei
- metadata-getriebene AI-Workbench im lokalen Viewer
- sichtbarer Kontext für System, Library/Source-Root, Source/Member und Evidence-Zeitpunkt
- Command Palette mit Suche und kontextabhängigen, allowlisteten Aktionen
- Rollenumschaltung für Developer, Architect, Tester und Product Owner
- Tastaturkürzel `Ctrl/Cmd+K` und `Escape`
- Sicherheitsstufen an den angebotenen Aktionen
- Backend liefert Rollen und Aktionen gemeinsam mit dem bestehenden UI-Metadatenvertrag
- keine neue Command- oder Credential-Logik im Frontend

Prüfstand:

- Format, Lint, Typecheck und lokale UI-Tests: grün
- vollständige Test-Suite: 879 bestanden, 0 fehlgeschlagen, 0 übersprungen
- Package Smoke, Docs Check, Demo-Golden-Path und Repository-Hygiene: grün
- Secret-Hygiene: keine Credentials in den geänderten Dateien; lokale Profilwarnungen bleiben außerhalb des Commits
- PR-CI und post-merge `main`-Pipeline: Bestandteil des laufenden Veröffentlichungsdurchlaufs

Bewusst nicht in dieser Iteration umgesetzt:

- keine Run-Karten oder Workflow-Schrittsteuerung
- keine neuen Credential-, Profil- oder Shell-Ausführungspfade im Frontend
- keine Änderungen an CLI, MCP, bestehenden Commands oder anderen Feature-Branches

### Iteration 2 — Workflow Run Cards und Guided Workflow Shell

Status: umgesetzt am 2026-08-21; lokale Qualitätsprüfungen grün.

Umgesetzt:

- eine einheitliche Run-Karte mit Status, Scope, Wiederholbarkeit, Evidence-Zustand und nächster Aktion
- vier verständliche Schritte: Scope, Analyse, Evidence-Freshness und Review
- „Next best action“ bleibt auf sichere, allowlistete lokale Navigation begrenzt
- Runs-Seitenleiste zeigt Status und Workflow-Preset direkt an

Bewusst nicht umgesetzt:

- keine automatische Ausführung von Analyse, Fetch oder mutierenden Commands aus der Karte
- keine eigene zweite Workflow-Engine; bestehende Run-Manifeste bleiben die Quelle

Nächstes To-do nach Iteration 2: Evidence Explorer mit belastbarer Hash- und Änderungsanzeige.

### Iteration 3 — Evidence Explorer und Freshness Detection

Status: umgesetzt am 2026-08-21; lokale Qualitätsprüfungen grün.

Umgesetzt:

- read-only Vergleich von Artefakten und aufgezeichnetem Source-Snapshot mit SHA-256
- klare Zustände `fresh`, `changed`, `missing`, `unverified` und `empty`
- relative Pfade, Evidence-Timeline und „Why is this known?“-Quellenangaben
- Aktualitätsprüfung bleibt lokal und kopiert weder Quellinhalte noch Secrets in die UI
- Run-Karte verlinkt bei Änderungen direkt zur Evidence-Prüfung

Bewusst nicht umgesetzt:

- kein automatischer Re-Fetch und keine automatische Aktualisierung eines Manifests
- keine externe Knowledge-Graph-Datenbank und keine Veröffentlichung von Source-Inhalten

Nächstes To-do nach Iteration 3: Rollenprofile direkt mit sicheren Prompt-Templates verbinden.

### Iteration 4 — Rollenprofile und Prompt-Templates

Status: umgesetzt am 2026-08-21; lokale Qualitätsprüfungen grün.

Umgesetzt:

- vier lokale Rollenprofile: Developer, Architect, Tester und Product Owner
- Profile wählen bevorzugte Use Cases, Prompt-Haltung, Ausgabeformat und Sicherheitsstufe vor
- Prompt-Workbench kann ein Rollenprofil anwenden und role-aware Templates lokal speichern
- neuer read-only Rollenvertrag unter `/api/prompt-builder/roles`
- Profile enthalten ausschließlich Prompt-Guidance; Credentials und Schlüsselmaterial bleiben ausgeschlossen

Bewusst nicht umgesetzt:

- keine Credential- oder Key-Verwaltung im Rollenprofil
- keine Änderung der bestehenden Prompt-Registry und keine doppelte Prompt-Engine

Nächstes To-do nach Iteration 4: OS-gebundene Secret-Verwaltung als separater, explizit sichtbarer Profil-/Key-Wizard.

### Iteration 5 — Profil-/Key-Wizard mit OS-gebundener Secret-Verwaltung

Status: umgesetzt am 2026-08-22; lokale Prüfungen grün, Gesamt-CI folgt im Veröffentlichungsdurchlauf.

Umgesetzt:

- neuer lokaler Key-Readiness-Vertrag mit Status, Quelle und bevorzugtem Speicherort ohne Schlüsselmaterial
- expliziter GUI-Schritt zum Erzeugen von Key-Material in Windows-secure storage oder der gitignorierten lokalen Key-Datei
- Browser-API nimmt keine Klartext-Secrets an und gibt weder Schlüssel noch absolute Zielpfade zurück
- tatsächliche Secret-Verschlüsselung bleibt bewusst CLI-first (`zeus secret encrypt`)
- Fehlerfälle wie fehlende Bestätigung und Windows-only Storage werden fail-closed behandelt

Bewusst nicht umgesetzt:

- kein Klartextfeld und kein Decrypt-Endpoint in der GUI
- keine automatische Rotation, kein Überschreiben vorhandener Schlüssel und keine externe Secret-Manager-Abhängigkeit

Nächstes To-do nach Iteration 5: neutrale Plugin-Verträge als deklarative Erweiterungspunkte.

### Iteration 6 — Deklarative Plugin-Verträge

Status: umgesetzt am 2026-08-22; lokale Prüfungen grün, Gesamt-CI folgt im Veröffentlichungsdurchlauf.

Umgesetzt:

- deterministischer, deduplizierter Katalog für Commands, Workflows, Rollen und Themes
- explizite Allowlist-Unterstützung für Plugin-IDs und Allowlist-Keys
- deklarative Verträge ohne Plugin-Ausführung, Netzwerkzugriff oder Telemetrie
- Validierung gegen ausführbare oder telemetrierende Plugin-Behauptungen

Bewusst nicht umgesetzt:

- keine dynamische Plugin-Ladung, keine beliebige Codeausführung und keine automatische Installation
- keine zweite Command- oder Workflow-Engine neben den bestehenden öffentlichen Verträgen

Nächstes To-do nach Iteration 6: Accessibility und responsive, telemetrie-freie UX-Politur.

### Iteration 7 — Accessibility und responsive UX-Politur

Status: umgesetzt am 2026-08-22; lokale Prüfungen grün, Gesamt-CI folgt im Veröffentlichungsdurchlauf.

Umgesetzt:

- sichtbare Keyboard-Fokuszustände und semantische Tab-/Tablist-Rollen für Haupt- und Report-Navigation
- `aria-selected`, `aria-current`, Live-Regionen und verständliche Labels für zentrale Arbeitsbereiche
- Reduced-Motion- und Forced-Colors-Unterstützung ohne Telemetrie
- Accessibility-Vertrag im UI-Metadatenpayload und bestehende responsive Breakpoints transparent beschrieben

Bewusst nicht umgesetzt:

- keine externe Accessibility-Bibliothek und kein clientseitiges Telemetrie- oder Session-Tracking
- keine vollständige WCAG-Zertifizierung; visuelle Prüfung mit Screenreader und Browser-Tools bleibt ein offener manueller Schritt

Nächstes To-do nach Iteration 7: manueller Accessibility-Walkthrough sowie Plugin-Katalog-Anbindung an bestehende Live-Metadaten.

## Weitere geplante Iterationen

1. Manueller Accessibility-Walkthrough mit Tastatur, Screenreader und Forced-Colors-Prüfung
2. Plugin-Katalog sicher an Live-Command-, Workflow- und Rollen-Metadaten anbinden
3. Profile, Key-Status und Evidence-Refresh als einheitliche sichere Setup-Checkliste darstellen

## Update-Regel für jede Iteration

Nach jeder Iteration werden hier ergänzt:

1. Status und Datum
2. wichtigste Änderungen
3. lokale Tests und CI-Ergebnis
4. bewusst nicht umgesetzte Punkte und Risiken
5. genau ein nächstes priorisiertes To-do

Die Datei bleibt damit der gemeinsame Produkt- und Übergabepunkt für Mensch, KI und weitere Entwickler.
