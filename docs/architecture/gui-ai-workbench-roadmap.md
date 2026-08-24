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

### Iteration 8 — Live-Katalog, sichere Setup-Checkliste und Accessibility-Walkthrough

Status: umgesetzt am 2026-08-22; automatisierte lokale Prüfungen und manueller Browser-Walkthrough grün, Gesamt-CI folgt im Veröffentlichungsdurchlauf.

Umgesetzt:

- Live-Plugin-Katalog aus den bestehenden Command-, Workflow-, Rollen- und neutralen Theme-Metadaten
- deterministische Katalogzusammenfassung mit sichtbarer Herkunft und optionaler lokaler `ZEUS_UI_PLUGIN_ALLOWLIST`
- keine Plugin-Ausführung, keine dynamische Installation und keine Telemetrie durch den Katalog
- einheitliche Secure Setup Checklist für Profil-/Quellbereich, lokale Key-Bereitschaft, Doctor und Evidence-Freshness
- sichere Zielnavigation von den Checklisten-Schritten zu Profilwizard, Key-Status, Doctor und Reports
- roving keyboard navigation für Haupt- und Report-Tabs mit Pfeiltasten, `Home`, `End`, `Enter` und `Space`
- wiederholbarer manueller Prüfablauf in `docs/architecture/gui-accessibility-walkthrough.md`

Bewusst nicht umgesetzt:

- keine automatische Evidence-Aktualisierung oder Remote-Fetch-Aktion aus der GUI
- keine Anzeige oder Entschlüsselung von Credentials, Schlüsselmaterial oder Klartext-Secrets
- keine vollständige Screenreader-/WCAG-Zertifizierung; der lokale Browser-Walkthrough bleibt der nächste Prüfpunkt

Nächstes To-do nach Iteration 8: manuellen Browser-Walkthrough mit realer Tastatur und einem Screenreader durchführen, anschließend visuelle Detailpolitur und Katalog-Erweiterungsdokumentation priorisieren.

### Iteration 9 — Operator-first Connection and AI Handoff

Status: umgesetzt lokal am 2026-08-22; fokussierte lokale GUI-/Doctor-/Prompt-Tests und Browser-E2E grün.

Umgesetzt:

- Setup trennt jetzt Konfigurationsprüfung und expliziten `doctor --probe`-ähnlichen read-only Verbindungstest.
- Redigierte Probe-Ergebnisse werden als Funktion/Status/Ziel/Detail angezeigt; keine Credential-Werte oder `show-resolved`-Interna werden in der UI ausgegeben.
- Neue read-only Route `/api/ui-context` zeigt den autoritativen lokalen Working Context aus `.zeus/working-context.json` inklusive Herkunft und Aktualitätsstatus.
- Neue AI-Session-Readiness-Strecke führt den Operator durch Environment-Handoff, Doctor/Probe, Working Context und Session-Prompt.
- Session-Prompt fordert die KI ausdrücklich auf, vor jedem Quellen-, Metadaten- oder Datenzugriff den exakten Scope zu lesen und bei jedem wesentlichen Schritt zu wiederholen.
- Session-Prompt-Generierung aus der GUI wird bis zur Prüfung von Doctor und Working Context geführt zurückgehalten.

Bewusst nicht umgesetzt:

- Die GUI lädt keine Environment-Variablen in einen bereits laufenden Shell-Prozess.
- Der Working Context wird nicht frei überschrieben: Änderungen laufen über Preview, Diff, explizite Bestätigung und optimistic-concurrency-Fingerprints.
- Kein Remote-Fetch, keine freie DB2-Abfrage und keine Mutation werden aus dem Browser ausgelöst; nur der explizit gewählte Doctor-Readiness-Probe darf die bestehenden read-only Verbindungstests ausführen.

Prüfstand:

- Fokussierte GUI-/Doctor-/Prompt-/Working-Context-Tests: grün.
- Generiertes UI-JavaScript und bestehende Accessibility-Verträge: grün.
- Echter Browser-E2E-Test der Preview-Aktion: grün.
- Full Suite, Paketierung, Hygiene und Release-Integrity werden im Abschlusslauf wiederholt; Docker-SFTP bleibt umgebungsabhängig.

Nächstes To-do nach Iteration 9: GUI-gestützte read-only Discovery-/Fetch-Previews auf Basis des reviewed Working Context; danach Accessibility-Walkthrough.

### Iteration 10 — Working Context Wizard und Provider Boundaries

Status: umgesetzt lokal am 2026-08-22; Commit und CI folgen dem normalen Review-Prozess.

Umgesetzt:

- Die GUI zeigt und bearbeitet den exakten First-Point-to-Check für Source Code,
  Objects, Metadata und Data.
- `Preview Changes` erzeugt einen redigierten Diff ohne Schreibvorgang.
- `Save Reviewed Context` verlangt explizite Bestätigung, einen aktuellen
  Preview-Fingerprint und einen unveränderten Ausgangskontext.
- Stale Previews werden mit einem Conflict abgewiesen, statt Änderungen still
  zu überschreiben.
- Gespeichert wird ausschließlich `.zeus/working-context.json`; Profile,
  Environment-Dateien, Key-Material und Remote-Systeme bleiben unangetastet.
- Die Browser-E2E-Strecke klickt die Preview-Aktion im echten Browser.
- [Provider Adapter Boundaries](../ai/provider-adapter-boundaries.md) beschreibt
  die sichere, optionale Einbindung von Grok und anderen Modellprovidern.

Bewusst nicht umgesetzt:

- keine automatische Grok-/OpenAI-/sonstige Provider-Ausführung;
- keine Übertragung von Workspace-Inhalten ohne explizit freigegebenes Paket;
- keine Remote-Fetch-, DB2- oder Mutationsaktion aus dem Context-Wizard;
- keine Bearbeitung von Credentials oder Schlüsselmaterial im Context-Wizard.

Grok wurde lokal nur auf Verfügbarkeit und Authentifizierungsstatus geprüft. Die
CLI war nicht authentifiziert; der Credential-Store wurde nicht ausgelesen und
es wurden keine Projektdaten übertragen.

Nächstes To-do nach Iteration 10: reviewed Working Context für sichere,
read-only Discovery-/Fetch-Previews verwenden und anschließend die noch
offenen Accessibility-Buttons manuell durchgehen.

### Iteration 11 — Reviewed Context Checkpoint und Fetch-Plan-Preview

Status: umgesetzt lokal am 2026-08-22; lokale Gesamtprüfungen grün.

Umgesetzt:

- Die GUI verlangt vor einer Discovery-Preview einen gespeicherten und
  geprüften Working Context; bei fehlendem Context wird kein Request ausgelöst.
- Discovery-Ergebnisse enthalten einen sicheren Working-Context-Checkpoint mit
  Kind, Profil und Scope, aber ohne Credentials, lokale Root-Pfade oder
  Schlüsselmaterial.
- Der neue read-only Schritt `Preview Fetch Plan` leitet die lokale
  Source-/Metadata-/Data-Route aus der validierten Konfiguration ab.
- Der Fetch-Plan führt keinen Remote-Fetch, keine IBM-i-Verbindung, keinen
  DB2-Zugriff und keinen Schreibvorgang aus; er macht die spätere Aktion nur
  transparent und überprüfbar.
- Tests decken UI-Gate, sichere Context-Projektion, bounded Routing und die
  Katalog-/Metadaten-Anbindung ab.

Bewusst nicht umgesetzt:

- kein automatischer Remote-Fetch aus der GUI;
- keine freie Datenbankabfrage und keine Mutation;
- kein Context-Bypass für die GUI, wenn die Review-/Save-Stufe fehlt;
- keine Übertragung von Workspace-Inhalten an Grok oder andere Provider.

Prüfstand:

- `npm test`: 899/899 Tests grün, 0 Fehler, 0 übersprungen;
- Format, Lint, Typecheck, Docs-Check, Quality und Hygiene: grün;
- GUI-Browser-E2E: 1/1 grün;
- die drei Windows-Symlink-Tests bleiben in CI-/Windows-Umgebungen
  berechtigt übersprungen.

Nächstes To-do nach Iteration 11: die Discovery-/Fetch-Preview mit einem
expliziten, weiterhin read-only lokalen Source-/Metadata-/Data-Fetch-Schritt
verbinden und dabei jeden tatsächlichen Endpunktzugriff sichtbar bestätigen.

### Iteration 12 — Bestätigter read-only Source-Member-Fetch

Status: umgesetzt lokal am 2026-08-24; fokussierte Fetch-/GUI-Tests grün.

Umgesetzt:

- neuer gemeinsamer \`fetchMemberService\`-Vertrag für einen deterministischen,
  credential-freien Fetch-Plan mit Plan-ID, Endpunkt, Source-Bibliothek,
  Source-Datei, Member und lokalem Ausgabepfad;
- \`Preview Fetch Plan\` zeigt bei vollständig aufgelöster Konfiguration einen
  sichtbaren Endpunkt und verlangt eine separate, explizite
  \`Confirm endpoint and fetch read-only source\`-Aktion;
- vor jeder tatsächlichen Ausführung läuft eine frische \`doctor --probe\`-artige
  Prüfung; bei Fehler wird der Fetch blockiert und kein lokales Artefakt
  gestartet;
- die bestätigte Ausführung liest remote ausschließlich den Source-Member und
  schreibt nur die geplanten lokalen Artefakte; Plan- und Ergebnisobjekte
  enthalten keine Credentials;
- stale Plan-IDs, fehlender Working Context, unsichere Pfade und unvollständige
  Endpunktdaten werden fail-closed abgewiesen;
- Service-, Action-Service- und UI-Flows sind mit synthetischen Endpunkten und
  Test-Exportern abgedeckt, ohne externe Systeme zu benötigen.

Bewusst nicht umgesetzt:

- kein freier Remote-Fetch ohne vorherige Preview und Endpunktbestätigung;
- noch kein gleichwertiger GUI-Fetch für DB2-Metadaten, Daten, Objekte oder
  Journale;
- keine automatische Aktualisierung bereits gefetchter Quellen und kein
  Diff-/Freshness-Status für Source-Member;
- keine Credential-Anzeige oder Credential-Übertragung in den Browser.

Prüfstand:

- Fetch-Service- und Action-Service-Tests: grün;
- lokale UI-Server-, Accessibility- und Browser-nahe Tests: grün;
- vollständige Format-, Lint-, Typecheck-, Gesamt- und E2E-Prüfungen folgen im
  Abschlusslauf dieser Iteration.

Nächstes To-do nach Iteration 12: Fetch-Ergebnisse um Source-Fingerprint und
Freshness-/Change-Check erweitern und daraus einen ebenso bestätigungspflichtigen
lokalen Refresh-Flow ableiten.

### Iteration 13 — Dockerloser echter SFTP-E2E-Fallback

Status: umgesetzt lokal am 2026-08-24; fokussierter SFTP-E2E-Test grün.

Umgesetzt:

- Docker bleibt der bevorzugte realistische SFTP-Testdienst für CI und lokale
  Integrationsumgebungen.
- Wenn Docker nicht verfügbar ist, startet der E2E-Test automatisch einen
  eingebetteten SSH/SFTP-Server auf `127.0.0.1` mit einem temporären,
  synthetischen Fixture-Bestand.
- Der Fallback unterstützt ausschließlich die für den Fetch benötigten
  read-only-Operationen, verweigert Mutationen und weist Pfade außerhalb des
  virtuellen `/incoming`-Roots zurück.
- Der Host-Key wird pro Testlauf flüchtig erzeugt; Benutzername, Passwort und
  Quellen sind ausschließlich synthetische Testwerte und werden nicht als
  Projekt- oder Betriebs-Credentials verwendet.
- Der E2E-Test prüft den echten SFTP-Fetch über SSH, die nachgelagerte Analyse,
  Bundle-Erzeugung sowie Read-only- und Path-Traversal-Schutz.
- Der direkte `ssh2`-Testtreiber bleibt auf die E2E-Entwicklungsabhängigkeiten
  beschränkt; seine MIT-Lizenz wurde geprüft und der Produktionspfad erhält
  keinen neuen SFTP-Server.
- Ein bestehender Timeout-Cleanup-Fehler im Transport-Diagnosepfad wurde
  behoben: erfolgreiche Transfers lassen keinen 30-Sekunden-Timer zurück.

Bewusst nicht umgesetzt:

- kein dauerhafter lokaler SFTP-Dienst und keine globale Benutzerverwaltung;
- kein Ersatz für die Docker-/OpenSSH-Abdeckung in CI;
- keine Schreib-, Lösch- oder Administrationsfunktionen im Test-Fallback;
- keine Übernahme von externen Projekt-, System-, Journal-, Personen- oder
  Credential-Daten.

Prüfstand:

- fokussierter echter SFTP-Fetch-/Analyze-/Bundle-E2E-Test: grün;
- eingebetteter Fallback ohne Docker: grün;
- Read-only- und Path-Traversal-Verträge: grün.

Nächstes To-do nach Iteration 13: Fetch-Ergebnisse um Source-Fingerprint und
Freshness-/Change-Check erweitern und daraus einen ebenso bestätigungspflichtigen
lokalen Refresh-Flow ableiten.

## Weitere geplante Iterationen

1. Source-Fingerprint und Freshness-/Change-Check für Fetch-Ergebnisse
2. Read-only GUI-Preview für Metadata, Data, Objects und Journals
3. Manuellen Accessibility-Walkthrough mit Tastatur, Screenreader und Forced-Colors-Prüfung wiederholen
4. Katalog-Erweiterungsdokumentation und sichere Authoring-Vorlage für neutrale Metadaten

## Update-Regel für jede Iteration

Nach jeder Iteration werden hier ergänzt:

1. Status und Datum
2. wichtigste Änderungen
3. lokale Tests und CI-Ergebnis
4. bewusst nicht umgesetzte Punkte und Risiken
5. genau ein nächstes priorisiertes To-do

Die Datei bleibt damit der gemeinsame Produkt- und Übergabepunkt für Mensch, KI und weitere Entwickler.
