# Quickstart: Multi-Root Workspace für Ticket-basierte Analyse

Dieses Quickstart beschreibt die sichere Einrichtung eines Multi-Root Workspaces:
- **Ticket-Folder**: Deine Ticket-Inhalte (zeitlich begrenzt)
- **Zeus-Repo**: Das `zeus-rpg-promptkit` (persistent)

**Ziel**: Sichere, isolierte Analyse einzelner Tickets mit credentials in der lokalen Session, nicht in Dateien.

---

## 1. VS Code Multi-Root Workspace erstellen

### 1.1 Ticket-Ordner vorbereiten

```powershell
# Neuer Ticket-Ordner
mkdir c:\Tickets\TICKET-12345
cd c:\Tickets\TICKET-12345

# Oder: Ein bestehendes Ticket-Verzeichnis öffnen
```

### 1.2 VS Code mit Multi-Root-Workspace

```powershell
# Option A: VS Code öffnen und Folder hinzufügen
code c:\Tickets\TICKET-12345

# Dann: File → Add Folder to Workspace → Zeus-Repo hinzufügen
# c:\Users\Developer.User\Tools\zeus-rpg-promptkit
```

**Oder Option B: Workspace-Datei erstellen**

```powershell
# Workspace-JSON erstellen
$workspaceContent = @{
    folders = @(
        @{ path = "c:\Tickets\TICKET-12345"; name = "Ticket-12345" },
        @{ path = "c:\Users\Developer.User\Tools\zeus-rpg-promptkit"; name = "Zeus" }
    )
    settings = @{}
} | ConvertTo-Json

$workspaceContent | Out-File "c:\Tickets\TICKET-12345.code-workspace" -Encoding UTF8

# Workspace öffnen
code "c:\Tickets\TICKET-12345.code-workspace"
```

**Ergebnis**: VS Code zeigt beide Ordner in der File Explorer Sidebar:
```
TICKET-12345 (Ticket-Verzeichnis)
├── [deine Tickets-Dateien]
Zeus (Repo)
├── cli/
├── src/
├── config/
└── ...
```

---

## 2. Umgebungsvariablen laden

### 2.1 PowerShell öffnen (im VS Code Terminal oder extern)

```powershell
# Im VS Code Integrated Terminal (Ctrl+`)
# Oder externe PowerShell
```

### 2.2 Zum Zeus-Repo wechseln und Env-Variablen laden

```powershell
# Zum Zeus-Repo wechseln
cd c:\Users\Developer.User\Tools\zeus-rpg-promptkit

# 1. Env-Datei aus der Vorlage vorbereiten (einmalig)
# Falls config/.env.local nicht existiert:
if (-not (Test-Path config\.env.local)) {
    copy config\.env.example config\.env.local
    Write-Host "Created config/.env.local — please edit with your credentials"
    notepad config\.env.local
    exit
}

# 2. Env-Variablen laden
. .\config\load-env.ps1

# Die Ausgabe sollte sein:
# ✓ ZEUS_OUTPUT_ROOT: ./output
# ✓ ZEUS_SOURCE_ROOT: ./rpg_sources
# ✓ ZEUS_DB_HOST: YOUR_HOST
# etc.
```

### 2.3 Überprüfe deine Konfiguration

```powershell
# Test: Umgebungsvariablen prüfen
node cli/zeus.js doctor
```

Erwartete Ausgabe:
```
Health check:
  ✓ CLI installation valid (Node.js v20.x)
  ✓ Config directory: c:\Users\Developer.User\Tools\zeus-rpg-promptkit\config
  ✓ Profiles loaded: 1 profile (default)
  ✓ ZEUS_DB_HOST set
  ✓ ZEUS_FETCH_HOST set
  Ready for analysis!
```

Falls Fehler: Siehe Troubleshooting unten.

---

## 3. Source Code fetchen (einmalig pro Ticket)

```powershell
# Zeus-Ordner noch aktiv im Terminal
cd c:\Users\Developer.User\Tools\zeus-rpg-promptkit

# Beispiel: Source von IBM i fetchen
node cli/zeus.js fetch --profile default

# Output kommt in: ./analysis/zeus-fetch/
# Dauer: 1–10 Minuten (abhängig von Datenmenge)
```

---

## 4. Analyse durchführen

```powershell
# Im gleichen Terminal (Session mit geladenen Env-Variablen)

# Einfache Analyse
node cli/zeus.js analyze --profile default

# Output: ./output/
# Artefakte: canonical-analysis.json, ai-knowledge.json, reports/
```

---

## 5. Im VS Code arbeiten

1. **Ergebnisse durchsuchen** (im `output/` oder `analysis/` Ordner)
2. **Reports öffnen** (`.md` Dateien lesen)
3. **Snippets mit Zeus-Hilfe anschauen** (im Chat: `zeus query-table ...`)

---

## 6. Zusammenfassung: Session-Workflow

| Schritt | Befehl | Wo? | Ausgabe |
|---------|--------|-----|---------|
| 1. Setup | `copy config\.env.example config\.env.local` | PowerShell | `.env.local` erstellt |
| 2. Setup | `notepad config\.env.local` | Editor | Credentials eingefügt |
| 3. Session | `. .\config\load-env.ps1` | PowerShell (Session) | Env-Vars in RAM |
| 4. Fetch | `zeus fetch --profile default` | PowerShell | `./analysis/zeus-fetch/` |
| 5. Analyze | `zeus analyze --profile default` | PowerShell | `./output/` |
| 6. Viewer | `zeus serve` | PowerShell (neuer Tab) | Browser: http://localhost:7890 |

---

## 7. Sicherheit

✓ **Was wird commits**: Code, Beispiel-Dateien (`.env.example`, `profiles.example.json`)  
✗ **Was wird NICHT commits**: `.env.local`, `profiles.json`, Secrets

✓ **Credentials sind sicher**:
- Nur in der lokalen PowerShell Session (`$env:VARIABLE`)
- Nicht in Dateien
- Nicht in Git
- Nicht sichtbar im Repo

✓ **KI-Chat ist sicher**:
- KI-Befehle in VS Code nutzen die gleichen Env-Vars
- KI sieht Variable-Namen, nicht die Werte
- KI kann keine Secrets ausgeben

---

## 8. Troubleshooting

### "Module nicht gefunden" / `node: not found`

```powershell
# Prüfe Node.js Installation
node --version

# Falls nicht installiert:
# Installiere Node.js 20+ von https://nodejs.org
# Oder: `winget install OpenJS.NodeJS`

# Danach Terminal neu starten:
exit
# Neue PowerShell öffnen
```

### "Env-Datei nicht gefunden" / `Cannot find path .env.local`

```powershell
# Überprüfe, dass du im Zeus-Repo-Verzeichnis bist
pwd  # Sollte: ...zeus-rpg-promptkit

# Datei existiert nicht? Erstelle sie:
Test-Path config\.env.local  # $False = nicht vorhanden

# Dann:
copy config\.env.example config\.env.local
notepad config\.env.local  # Bearbeite die Werte
```

### "Kritische Variablen nicht gesetzt"

```powershell
# Überprüfe: Welche Variablen sind nicht gesetzt?
. .\config\load-env.ps1  # Wird detailliert angezeigt

# Beispiel: ZEUS_DB_HOST nicht gesetzt
# → Bearbeite config/.env.local, Zeile mit ZEUS_DB_HOST

# Danach neu laden:
. .\config\load-env.ps1
```

### "zeus: command not found" / "node: cannot find module"

```powershell
# Prüfe: Bist du im richtigen Verzeichnis?
cd c:\Users\Developer.User\Tools\zeus-rpg-promptkit
pwd

# Prüfe: Hast du `npm install` durchgeführt?
npm install  # (falls noch nicht geschehen)

# Dann:
node cli/zeus.js doctor
```

### "Credentials zu schwach" / Authentifizierungsfehler

```powershell
# Überprüfe config/.env.local:
notepad config\.env.local

# Check: Ist ZEUS_DB_USER der richtige IBMi-User?
# Check: Ist ZEUS_DB_PASSWORD korrekt?
# Check: Ist ZEUS_DB_HOST erreichbar?

# Test auf IBMi selbst:
# ssh ZEUS_DB_USER@ZEUS_DB_HOST
# Falls SSH nicht geht: Credentials überprüfen
```

---

## 9. Häufige Fragen

**F: Muss ich immer `. .\config\load-env.ps1` ausführen?**  
A: Ja, aber nur einmalig pro PowerShell-Session. Die Env-Vars bleiben dann für alle `zeus`-Befehle sichtbar.

**F: Kann ich Env-Variablen in `.env.local` ändern und sofort nutzen?**  
A: Nein, erst `. .\config\load-env.ps1` erneut ausführen. Die PowerShell-Session lädt die Datei nicht automatisch neu.

**F: Kann ich mehrere Tickets parallel analysieren?**  
A: Ja! Öffne mehrere PowerShell-Tabs/Sessions. Jede Session lädt ihre eigenen Env-Vars.

**F: Warum darf ich `.env.local` nicht committen?**  
A: `.env.local` enthält deine persönlichen Credentials (Passwörter, Hostnames). Diese dürfen nie ins Repository.

**F: Wie teile ich meine Analyse mit einem Kollegen?**  
A: Siehe [safe-sharing.md](safe-sharing.md) — Zeus generiert ZIP-Bundles ohne Secrets.

---

## 10. Nächste Schritte

1. **Workspace erstellen** (Schritt 1)
2. **Env-Variablen laden** (Schritt 2)
3. **Source fetchen** (Schritt 3 — optional, falls remote)
4. **Analyse durchführen** (Schritt 4)
5. **Im VS Code arbeiten** (Schritt 5)
6. **Im KI-Chat analysieren** (Copilot-Chat nutzen)

---

Fragen? Siehe auch:
- [BEST_PRACTICE_GUIDE.md](BEST_PRACTICE_GUIDE.md)
- [secure-env-setup.md](secure-env-setup.md)
- [investigation-workflows.md](investigation-workflows.md)
