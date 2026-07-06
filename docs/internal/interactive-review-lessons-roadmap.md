# Lessons-Learned & Fahrplan: Review interaktiver Display-Programme

> Produktverbesserungs-Roadmap für Zeus RPG PromptKit.
> Abgeleitet aus einer realen Review-Session eines interaktiven Display-File-Programms
> (webface/PUI-Grid) mit abgeleiteter (berechneter) Anzeige-Spalte.
> **Bewusst vorgangs-, system- und firmenneutral gehalten** — nur generische Produkt-Erkenntnisse.

## Kontext der Session (generisch)

Aufgabe war ein evidenzbasiertes Review, ob ein interaktives Display-Programm eine
**abgeleitete Spalte** korrekt ermittelt und **im Grid anzeigt** (Wert stammt nicht aus einer
gespeicherten Spalte, sondern wird zur Laufzeit aus zwei Lookup-Tabellen berechnet und in
einem webface/PUI-Grid dargestellt; zusätzlich existiert ein Spalten-Tooltip).

Der statische Teil lief gut (Scanner, kanonisches Modell, Feld-/Estate-Suche, DB2-Read-only).
Reibung entstand an drei Stellen: **(1) Einzelmember-Fetch**, **(2) Verknüpfung statischer
Analyse mit Laufzeit-Evidenz**, **(3) Analyse von webface/PUI-Display-Artefakten**.

---

## Lessons Learned (Kurzfassung)

| # | Beobachtung | Auswirkung | Kategorie |
|---|---|---|---|
| L1 | Einzelmember-Fetch schrieb auf einen IFS-Pfad statt lokal herunterzuladen; meldete trotzdem „OK" | Scheinbarer Erfolg, 0 lokale Dateien; Umweg über vollständigen `fetch` nötig | Fetch/UX |
| L2 | CLI-Alias schrieb `--member` → `--members` um, der Command las aber nur `--member`/`--m` | Option wirkungslos, verwirrende Fehlersuche | CLI/Args |
| L3 | Remote-Cleanup nutzte einen ungültigen CL-Befehl zum Löschen eines IFS-Objekts | Abbruch mit Systemfehler; Remote-Reste bleiben liegen | Fetch/CL |
| L4 | Env-Variable übersteuerte still den Profilwert der Quellbibliothek | Falsche Bibliothek ohne Hinweis; nur mit explizitem Flag umgehbar | Config/Precedence |
| L5 | Kein einfacher Weg, den **Job** einer laufenden interaktiven/webface-Session für den Joblog zu finden | Laufzeitfehler-Diagnose blockiert | Runtime-Diagnose |
| L6 | Abgleich „Objekt-Kompilierstand vs. Quelländerung" nur per manueller Katalogabfrage möglich | Stale-Object-Risiko schwer erkennbar | Runtime-Diagnose |
| L7 | Read-only-SQL nutzt `CURRENT SCHEMA`/SQL-Naming, das Programm zur Laufzeit aber die Job-**Bibliotheksliste** (`*LIBL`) | Statische Query und Laufzeit können unterschiedliche Objekte treffen → falsche Schlüsse | Runtime-Kontext |
| L8 | webface/PUI-Schlüsselwörter (HTML/JSON) sind über Spalte-72-Fortsetzungszeilen zerhackt | Tooltips, Feldbindungen, Spalten kaum grep-/analysierbar | Scanner/PUI |
| L9 | Keine Projektion „RPG-Feld → verstecktes DDS-Feld → PUI-Grid-Spalte/Binding" | „Feld wird im Code gesetzt, erscheint aber nicht in der UI" nicht nachvollziehbar | Scanner/PUI |
| L10 | Statische Stärke, aber keine Brücke Statik↔Laufzeit (z. B. embedded-SQL-Ergebnis vs. Joblog) | Root-Cause „Zelle bleibt leer" nur mühsam eingrenzbar | Diagnose-Workflow |

---

## Initiative 1 — Einzelmember-Fetch robust & vorhersehbar machen

**Problem (L1–L4).** Der Pfad zum Holen *eines* Members hat mehrere Kanten: falsches Download-Ziel
(IFS statt lokal), Alias-/Arg-Mismatch, ungültiger Remote-Cleanup-Befehl, stille Env-Übersteuerung.

**Lösung.**
- Einzelmember-Export garantiert lokal materialisieren: nach dem Remote-Export **immer** einen
  verifizierten lokalen Download durchführen und die geschriebene Datei per Existenz-/Größen-/
  Checksummen-Check bestätigen, bevor „OK" gemeldet wird.
- Alias-Normalisierung und Command-Arg-Lesen **aus einer einzigen Quelle** speisen (kanonische
  Optionsnamen + Aliase zentral), plus Contract-Test, der jeden Alias auf den tatsächlich
  gelesenen Key mappt.
- Remote-Cleanup auf den korrekten, plattform-gültigen Löschmechanismus für IFS-Objekte umstellen;
  Fehlerfälle klar melden statt hart abzubrechen.
- **Precedence-Transparenz:** Wenn eine Env-Variable einen Profilwert übersteuert, das **im
  Klartext anzeigen** (z. B. in `doctor --show-resolved` als „overridden by env: …") und optional
  eine Warnung ausgeben.

**Betroffene Komponenten.** `src/fetch/fetchService.js`, `src/fetch/jt400CommandRunner.js`
(Einzelmember-Export/-Download), `src/fetch/jt400Downloader.js`, CLI-Alias-/Arg-Handling in
`cli/zeus.js`, `src/config/runtimeConfig.js`, `src/cli/commands/doctorCommand.js`.

**Akzeptanz/Tests.** Contract-Test „single-member fetch materializes locally"; Alias→Key-Mapping-Test;
`doctor`-Ausgabe listet Env-Übersteuerungen; Cleanup-Pfad hat einen Fehlerpfad-Test.

---

## Initiative 2 — Runtime-Diagnose-Pack für Programme

**Problem (L5–L7).** Bei „berechneter Wert erscheint nicht" fehlte der schnelle Sprung von der
Statik zur Laufzeit: den ausführenden Job finden, Objekt-Aktualität prüfen, und erkennen, dass
Read-only-Query-Kontext ≠ Programm-Laufzeitkontext sein kann.

**Lösung (read-only, S2).** Ein gebündelter Diagnose-Pack pro Programm/Objekt, der zusammenführt:
- **Job-Lokalisierung:** aktive Jobs read-only nach ausführendem Programm/Objekt bzw. Benutzer
  filtern und Kandidaten-Jobs mit Statusfunktion auflisten (inkl. webface-/Server-Subsysteme,
  nicht nur klassisch interaktive) → direkter Einstieg für `joblog`.
- **Staleness-Check:** Objekt-Kompilierzeitstempel vs. Änderungszeitstempel des Quellmembers
  gegenüberstellen und „Objekt möglicherweise veraltet ggü. Quelle" flaggen.
- **Kontext-Abgleich:** den bei Read-only-SQL genutzten Schema-/Naming-Kontext **explizit
  ausgeben** und gegen die (potenzielle) Job-Bibliotheksliste bzw. das Namensverfahren des
  Programms spiegeln; warnen, wenn statische Query und Laufzeit unterschiedliche Objekte treffen
  könnten (Mehrfach-Objekte gleichen Namens in verschiedenen Bibliotheken hervorheben).

**Betroffene Komponenten.** `src/investigation/diagnosticPackRunner.js` (neuer Pack-Typ),
`src/db2/readOnlyQueryService.js` (Kontext-Reporting), `src/cli/commands/joblogCommand.js` /
`inspect-object`, ggf. `src/cli/commands/` neuer `diagnose`-Wrapper.

**Akzeptanz/Tests.** Diagnose-Pack liefert deterministische, redigierte JSON-Sektionen
(Job-Kandidaten, Staleness, Kontext-Warnungen); Contract-Test für die Pack-Form; Naming-/`*LIBL`-
Hinweis erscheint, wenn ein Objektname in mehreren Bibliotheken existiert.

---

## Initiative 3 — webface/PUI-Display-Artefakte first-class machen

**Problem (L8–L9).** Display-File-Quellen mit webface/PUI betten HTML/JSON in
Fortsetzungszeilen ein. Ohne Reassemblierung sind Tooltips, Spalten und Feldbindungen praktisch
nicht durchsuch- oder prüfbar; und es gibt keine Spur „RPG-Feld → verstecktes DDS-Feld →
Grid-Spalte".

**Lösung.**
- **Continuation-Reassembler:** Spalte-72-Fortsetzungen zu logischen Schlüsselwort-/String-Werten
  zusammenfügen, bevor extrahiert wird (verlustfrei, mit Rück-Mapping auf Ursprungszeilen für
  Evidenz `{ file, startLine, endLine, text }`).
- **PUI-Projektion:** Grid-Spalten, deren `fieldName`-Bindung, Datentyp/Formatierung, Labels und
  Tooltips als strukturierte Items ins kanonische Modell aufnehmen.
- **Display-Feld-Trace:** RPG-Zuweisung eines Feldes ↔ verstecktes DDS-Feld ↔ PUI-Grid-Spalte
  verknüpfen, sodass „im Code gesetzt, aber nicht sichtbar gebunden/angezeigt" als Befund
  auffällt (z. B. Feld gesetzt, aber Spalte an anderes Feld gebunden, oder Typ-/Format-Mismatch).
- **Konsistenz-Signale:** einfache Checks wie „Tooltip-/Label-Text nennt andere Codes als der
  Wertebereich des gebundenen Feldes" als QA-Hinweis melden (kein Hardcode konkreter Werte —
  generischer Abgleich Tooltip-Enumeration ↔ referenzierte Wertquelle).

**Betroffene Komponenten.** `src/scanner/ddsScanner.js` (Reassembler + Extraktion),
`src/context/canonicalAnalysisModel.js` (PUI-Entitäten), `src/pui/` (Projektion/Trace),
`src/qa/` (Konsistenz-Signale), Fixtures unter `tests/fixtures/` + Fälle in
`tests/scanner-corpus.test.js`.

**Akzeptanz/Tests.** Fixture eines PUI-Grids mit Fortsetzungszeilen → Reassembler liefert
korrekte logische Strings; Projektion listet Spalte↔Feldbindung + Tooltip; Trace-Test erkennt
ein bewusst „gesetzt-aber-nicht-gebunden"-Beispiel.

---

## Initiative 4 — Diagnose-Workflow „Statik ↔ Laufzeit" als Preset

**Problem (L10).** Die Einzelbausteine (Scanner, Feldsuche, SQL, Joblog, Objektinfo) existieren,
aber es fehlt ein geführter Ablauf, der bei einer Symptommeldung („abgeleiteter Wert erscheint
nicht") automatisch die richtige Evidenzkette zusammenstellt.

**Lösung.** Neues Workflow-Preset/-Mode „interactive-runtime-diagnose" (read-only), das kombiniert:
1. statische Ableitungslogik des Feldes (Prozedur/embedded SQL) lokalisieren,
2. die embedded-SQL-Ableitung als **eigenständige** read-only Prüfsequenz nachstellen,
3. PUI-Binding des Anzeigefeldes prüfen (Initiative 3),
4. Objekt-Staleness + Kontext-Abgleich anhängen (Initiative 2),
5. Ergebnis als redigiertes Artefakt mit klarer „nächster Schritt + Risikolevel"-Note ausgeben.

**Betroffene Komponenten.** `src/workflow/workflowModeRegistry.js`,
`src/workflow/workflowPresetRegistry.js`, `src/ai/contextOptimizer.js` (Token-Budget),
Prompt-Template unter `src/prompt/templates/`, Registrierung in `src/prompt/promptRegistry.js`.

**Akzeptanz/Tests.** Preset-Contract-Test; End-to-End-Smoke gegen Fixtures; Artefakt enthält
die fünf Sektionen deterministisch und redigiert.

---

## Priorisierung / Reihenfolge

| Phase | Fokus | Initiativen | Begründung |
|---|---|---|---|
| P1 | Sofort-Robustheit | **Initiative 1** | Kleine, klar abgegrenzte Fixes; entfernt tägliche Reibung & falsche „OK"-Signale |
| P2 | Laufzeit-Sichtbarkeit | **Initiative 2** | Schließt die größte Diagnose-Lücke (Job/Joblog, Staleness, Kontext) read-only |
| P3 | PUI-Analyse | **Initiative 3** | Höchster analytischer Mehrwert für Reviews von Display-Programmen |
| P4 | Orchestrierung | **Initiative 4** | Bündelt P2+P3 zu einem wiederholbaren, geführten Ablauf |

---

## Leitplanken (für alle Initiativen)

- **Read-only-Default** auf allen Zielsystemen; keine neuen Schreibpfade.
- **Evidenz statt Vermutung:** jede neue Ausgabe trägt `{ file, startLine, endLine, text }` bzw.
  eindeutige Objekt-/Job-Referenzen.
- **Deterministische, sortierte, redigierte Ausgaben** (Secret-Masking vor jedem Schreiben).
- **Keine Firmen-/Vorgangs-Internas** in Code, Fixtures, Doku oder generierten Artefakten —
  Fixtures ausschließlich synthetisch.
- **Contract-Tests zuerst** für jede neue Artefaktform.
