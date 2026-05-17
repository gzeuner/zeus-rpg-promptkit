---
Title: Sichere Umgebungskonfiguration für Zeus RPG PromptKit
Description: Interne technische Dokumentation zu Architektur, Vertragen und Implementierungsdetails.
Last Updated: 2026-05-17
---

# Sichere Umgebungskonfiguration für Zeus RPG PromptKit

## Überblick

Die Umgebungsvariablen (Hosts, Credentials) werden sicher konfiguriert, ohne dass Secrets ins Repository gelangen.

## Sicherheitskonzept

```
Repository (committed)           Lokale Session (RAM)
─────────────────────────────────────────────────────
.env.example          -->  Umgebungsvariablen
profiles.example.json -->  in $env: gespeichert
config/load-env.ps1   -->  Keine Secrets sichtbar!
                           Referenzieren ${env:VAR}
```

### Wichtig

- `.env.local` ist **gitignoriert** (enthält deine echten Credentials)
- `config/local-only/profiles.json` ist **gitignoriert** (deine lokale Profile)
- Credentials verlassen nie das lokale System
- KI sieht nur Variable-Namen, nie die echten Werte
- Beim Laden werden Passwords maskiert (*** in der Konsole)

---

## Setup für User und KI

### 1. Basis-Setup (einmalig)

```powershell
# Im Projektverzeichnis:
cd c:\Users\Developer.User\Tools\zeus-rpg-promptkit

# Kopiere die Beispiel-Datei
copy config\.env.example config\.env.local
copy config\profiles.example.json config\local-only\profiles.json

# Bearbeite die Werte mit deinen echten Credentials
notepad config\.env.local
notepad config\local-only\profiles.json
```

### 2. Umgebungsvariablen laden (in PowerShell)

```powershell
# Variablen aus .env.local laden
. .\config\load-env.ps1
```

Das Skript:
- Liest `config/.env.local`
- Setzt die Variablen in der aktuellen PowerShell-Session (`$env:VARIABLE`)
- Maskiert Passwords in der Konsole (*** statt Klartext)
- Validiert kritische Variablen
- Meldet, ob alles bereit ist

### 3. Verwendung mit Profilen

Nach dem Laden kannst du `zeus`-Befehle ausführen:

```powershell
# Mit den Profilen aus config/local-only/profiles.json
zeus analyze --profile default
zeus query-table --profile default --table MEINE_TABELLE
```

---

## Verwendung im KI-Chat

1. **Skript ausführen** (vor KI-Befehlen):
   ```powershell
   . .\config\load-env.ps1
   ```

2. **Profile nutzen** (ohne Credentials preiszugeben):
   ```
   "Analysiere den Source mit --profile default"
   ```

3. **Queries durchführen** (Variablen sind gesetzt):
   ```
   "Führe `zeus query-table --profile default --table MEINTABLE` aus"
   ```

Die KI:
- Sieht nur die Variable-Namen (z. B. `${env:ZEUS_DB_HOST}`)
- Sieht nie die echten Werte
- Kann über Variable-Namen sprechen, ohne Secrets zu offenbaren
- Die CLI löst die Variablen zur Runtime auf

---

## Dateistruktur

```
.gitignore                      <- .env.local und profiles.json ignoriert
config/
  .env.example                  <- Beispiel-Vorlage (im Repo)
  .env.local                    <- DEINE echten Werte (gitignored)
  load-env.ps1                  <- Lädt und setzt Variablen
  profiles.example.json         <- Profile-Vorlage (im Repo)
  profiles.json                 <- DEINE echte Konfiguration (gitignored)
```

---

## Checkliste für Sicherheit

- [x] `.env.local` ist in `.gitignore`
- [x] `config/local-only/profiles.json` ist in `.gitignore`
- [x] Niemals Credentials in Repo-Dateien schreiben
- [x] `load-env.ps1` wird vor Zeus-Befehlen ausgeführt
- [x] KI sieht nur Variable-Namen, nicht die Werte
- [x] Profiles referenzieren Variablen via `${env:VAR}`
- [x] Passworte werden beim Laden maskiert (*** nicht ausgegeben)

```powershell
# Pruefen ob Variablen gesetzt sind
$env:ZEUS_DB_HOST
$env:ZEUS_DB_USER

# Falls leer: .env-Datei bearbeiten und neues PowerShell-Fenster oeffnen
```

### Multi-Maschinen-Setup (z.B. SYS_TEST + SYS_PROD)

Env-Vars haben immer Vorrang vor Profilwerten. Fuer zwei Maschinen genuegt es,
in `.env.project.local` die Rollen-spezifischen Variablen zu setzen:

```ini
# Sourcen von SYS_TEST fetchen
ZEUS_FETCH_HOST=SYS_TEST
ZEUS_FETCH_USER=IBMI_USER
ZEUS_FETCH_PASSWORD=***

# DB-Default gegen SYS_TEST
ZEUS_DB_HOST=SYS_TEST
ZEUS_DB_USER=IBMI_USER
ZEUS_DB_PASSWORD=***

# Metadaten/Analysen gegen SYS_PROD (optional — Fallback auf ZEUS_DB_* wenn weggelassen)
ZEUS_METADATA_DB_HOST=SYS_PROD
ZEUS_METADATA_DB_USER=IBMI_USER
ZEUS_METADATA_DB_PASSWORD=***
```

Detaillierte System-Konfiguration: [system-environment-setup.md](system-environment-setup.md)

---

## Nächste Schritte

1. `.env.local` mit deinen Werten erstellen
2. `.env.project.local` mit System-Credentials erstellen
3. `load-env.ps1` ausführen
4. `zeus query-table --profile sample-source --table MEINE_TABELLE` testen
5. Mit KI-Chat arbeiten (Variablen bleiben gespeichert)
