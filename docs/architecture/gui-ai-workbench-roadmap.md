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

### Nächste sinnvolle Iteration

**Workflow Run Cards und Guided Workflow Shell**

- eine einheitliche Run-Karte für Start, Fortschritt, Ergebnis, Fehler, Evidence und Wiederholung
- Workflow-Schritte aus den bestehenden Workflow-Metadaten darstellen
- Scope vor jedem Schritt sichtbar bestätigen
- „Next best action“ aus Workflow- und Command-Metadaten ableiten
- read-only/reversible Aktionen zuerst, mutierende Aktionen weiterhin bewusst getrennt

## Weitere geplante Iterationen

1. Workflow Run Cards und Guided Workflow Shell
2. Evidence Explorer mit Freshness- und Change-Detection-Anzeige
3. Rollenprofile und Prompt-Templates als sichere lokale Konfiguration
4. Profil-/Key-Wizard mit OS-gebundener Secret-Verwaltung
5. Plugin-Verträge für Commands, Workflows, Rollen und Themes
6. Accessibility, responsive Layouts, Telemetrie-freie lokale UX und visuelle Politur

## Update-Regel für jede Iteration

Nach jeder Iteration werden hier ergänzt:

1. Status und Datum
2. wichtigste Änderungen
3. lokale Tests und CI-Ergebnis
4. bewusst nicht umgesetzte Punkte und Risiken
5. genau ein nächstes priorisiertes To-do

Die Datei bleibt damit der gemeinsame Produkt- und Übergabepunkt für Mensch, KI und weitere Entwickler.
