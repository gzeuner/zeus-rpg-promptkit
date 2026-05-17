# Zeus RPG PromptKit – GUI & Prompt Builder  
**Living Document / Arbeitspapier**

**Status:** Draft v0.2 (17.05.2026)  
**Ziel:** Dieses Dokument dient als **roter Faden** und zentrale Entscheidungsgrundlage für die Weiterentwicklung der GUI.  
Es wird laufend aktualisiert, abgehakt und als Basis für alle weiteren Ableitungen genutzt.

---

## 1. Vision & Produktkurs (fokussiert)

**Zeus RPG PromptKit** wird das führende **AI-Prompt-Workbench** für IBM i / RPG-Entwickler, Architekten und Modernisierer.

**Kernidee (unverändert, aber geschärft):**  
Der User soll Use-Cases als Bausteine zusammenklicken, eigene Anforderungen ergänzen und **sofort einen hochwertigen, optimierten Prompt** erhalten – den er live bearbeiten, speichern, kopieren oder direkt an eine KI weitergeben kann.

**Fokussierter Produktkurs:**
- **Kernprodukt** = Modulärer Prompt Builder + nahtlose Integration in den bestehenden Analyse-Workflow (`zeus analyze`)
- Wir bauen **nicht** eine generische KI-Plattform, sondern die **beste Prompt-Workbench speziell für Legacy-RPG & IBM i**
- Geschwindigkeit & Pragmatismus vor Technologie-Hype
- Zuerst Web-basiert (Node.js), später optional als Desktop-App

**Zielgruppe (unverändert):**  
IBM i / RPG-Entwickler, System-Architekten, Modernisierungs- und QA-Teams.

**Name der GUI:**  
**Zeus Prompt Workbench** (Arbeitstitel – finaler Name wird noch festgelegt)

---

## 2. Technische Strategie: Node.js-First

**Entscheidung:**  
**Node.js-First** – wir bauen konsequent auf der bestehenden Technologie-Basis auf (`zeus serve` + React-Viewer).

**Warum Node.js-First?**
- Bestehende Code-Basis (`src/viewer/`) kann 1:1 weiterverwendet und massiv erweitert werden
- Schnellere Iterationen, kein neuer Tech-Stack
- Einfache Entwicklung, Debugging und Deployment
- Spätere Desktop-Variante möglich (Electron)
- Kein unnötiger Wechsel zu Rust/Tauri zum jetzigen Zeitpunkt

**Electron als Option (nicht verpflichtend):**
- Electron kann später als dünner Wrapper um die bestehende Web-App gelegt werden (sehr geringer Aufwand)
- Vorteile: Echte Desktop-App, Dateisystem-Zugriff, Offline-Fähigkeit, Tray-Icon etc.
- Entscheidung über Electron wird **nach MVP** getroffen – kein Blocking-Faktor

**Status:** Node.js-First-Strategie festgelegt [x]

---

## 3. Kern-Feature: Modulärer Prompt Builder

### 3.1 Haupt-Flow (stark fokussiert)
1. Dashboard mit **Use-Case Cards**
2. **Prompt Canvas** (einfaches Add + Reihenfolge per Drag & Drop)
3. Pro-Baustein-Konfiguration
4. Großes „Zusätzliche Anforderungen“-Feld (+ Datei-Upload)
5. **Live Preview** des fertigen Prompts (Split-View)
6. Direkte Actions: Edit • Copy • Save Template • Export

### 3.2 Use-Cases (fokussierte Auswahl – MVP)

| Use-Case                          | Icon | Priorität | Status |
|-----------------------------------|------|-----------|--------|
| Documentation Generation          | 📖   | High      | [ ]    |
| Impact / Change Analysis          | 🔄   | High      | [ ]    |
| Security & Access Review          | 🔐   | High      | [ ]    |
| Modernization Roadmap             | 🚀   | High      | [ ]    |
| Test-Case Generation              | 🧪   | Medium    | [ ]    |
| Onboarding / Knowledge Transfer   | 👋   | Medium    | [ ]    |

*(Weitere Use-Cases werden erst nach MVP-Erfolg hinzugefügt)*

---

## 4. Architektur (überarbeitet – Node.js-First)
Zeus Prompt Workbench (Node.js + React)
├── zeus serve (bestehender Node.js-Server)
│   └── Erweiterung um neue API-Routen für Prompt Builder
├── Frontend (React + Vite)
│   ├── shadcn/ui + Tailwind (IBM-Blue Dark Theme)
│   ├── components/
│   │   ├── UseCaseCard.tsx
│   │   ├── PromptCanvas.tsx
│   │   ├── LivePreview.tsx
│   │   └── ...
│   └── pages/PromptBuilder.tsx
├── Integration
│   ├── Direkter Zugriff auf ./output/ Ordner nach zeus analyze
│   ├── Tauri/Electron-Wrapper (optional, Phase 2+)
│   └── CLI-Bridge (falls nötig)


**Vorteile dieser Architektur:**
- Maximale Wiederverwendung bestehenden Codes
- Sehr schnelle Entwicklung des MVP
- Leichte Skalierbarkeit (später PWA oder Electron)

---

## 5. Roadmap (stark fokussiert)

### Phase 1 – MVP (Prompt Builder Core)
- [ ] Use-Case Cards + Canvas + Live Preview
- [ ] Integration mit bestehendem `output/` Ordner (`zeus analyze` → direkt Prompt Builder öffnen)
- [ ] Copy / Edit / Save Template (lokal)
- [ ] Token-Schätzung
- [ ] Schönes, professionelles Design (IBM-Blue Theme)

**Ziel:** In 2–3 Wochen ein lauffähiges, überzeugendes MVP haben

### Phase 2 – Integration & Polishing
- [ ] Wizard-Modus („Was willst du erreichen?“)
- [ ] Klickbare Mermaid-Graphs → Prompt direkt starten
- [ ] Meine Templates + einfacher Export
- [ ] One-Click zu ChatGPT / Claude / Cursor
- [ ] Entscheidung: Electron-Wrapper ja/nein

### Phase 3 – Erweiterung (nach MVP-Feedback)
- Prompt-Optimierer
- Version-History
- Community-Templates
- Weitere Use-Cases

---

## 6. Nächste Schritte (sofort)

**Sofort (nächste 1–2 Wochen):**
- [x] Dieses Dokument finalisieren & ins Repo legen
- [ ] Bestehende React-Viewer-Komponenten als Basis für neuen Prompt Builder nutzen
- [ ] Erste Use-Case Cards + Canvas als Prototyp bauen
- [ ] Node.js-Server um neue Prompt-Builder-Routen erweitern

---

## 7. Offene Fragen / Entscheidungen

- Finaler Produktname (`Zeus Prompt Workbench`?)
- Wie speichern wir Templates? (`~/.zeus/templates/` oder browser storage + Dateisystem-Export)
- Soll das MVP zuerst nur als Erweiterung von `zeus serve` laufen (localhost) oder direkt als Standalone-React-App?
- Zeitpunkt für mögliche Electron-Integration

---

**Dieses Dokument ist das zentrale Living Document.**  
Jede neue Idee, jedes Mockup oder jede Entscheidung wird hier eingetragen. Wir arbeiten streng danach.

---