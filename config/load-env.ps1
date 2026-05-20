# load-env.ps1
# Laedt Umgebungsvariablen aus .env-Dateien in die aktuelle PowerShell-Session
#
# Einmalige Freigabe (kein Admin noetig, nur fuer den aktuellen User):
#   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
#
# Verwendung danach (Dot-Sourcing, damit die Variablen in der Session bleiben):
#   . .\config\load-env.ps1                    # Laedt config/.env.local
#   . .\config\load-env.ps1 -Environment project  # Laedt config/.env.project.local
#
# Multi-Maschinen-Setup (Sourcen SYS_TEST, Daten SYS_PROD):
#   In .env.project.local einfach ZEUS_METADATA_DB_HOST=SYS_PROD setzen.
#   Da Env-Vars immer Vorrang vor Profilwerten haben, genuegt das.
#   Beispiel:
#     ZEUS_FETCH_HOST=SYS_TEST        <- Sourcen von Testsystem
#     ZEUS_DB_HOST=SYS_TEST           <- DB-Default (Fallback)
#     ZEUS_METADATA_DB_HOST=SYS_PROD  <- Metadaten/Analysen von Prod
#     ZEUS_METADATA_DB_USER=IBMI_USER
#     ZEUS_METADATA_DB_PASSWORD=***
#
# Alternative ohne Policy-Aenderung (Einmalaufruf, kein Dot-Sourcing):
#   powershell -ExecutionPolicy Bypass -File .\config\load-env.ps1 -Environment project
#   ACHTUNG: Variablen sind dann nur im gestarteten Subprozess sichtbar, nicht in
#            der aktuellen Session! Fuer den normalen Workflow RemoteSigned setzen.
#
# Sicherheit:
#   - Credentials werden nur in die aktuelle Session geladen
#   - Niemals in Logs oder Prozess-Umgebung exportiert
#   - Keine Ausgabe von Credential-Werten in der Konsole
#
# Ablage der .env-Dateien:
#   Bevorzugter Speicherort ist config/ (neben diesem Skript).
#   Fallback: Projekt-Root (rueckwaertskompatibel)

param(
    [string]$Environment = "default"
)

$ErrorActionPreference = "Stop"

# ── Datei-Pfade bestimmen
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$envFileName = if ($Environment -eq "default") { ".env.local" } else { ".env.$Environment.local" }
# Suche zuerst im config/-Verzeichnis, dann im Projekt-Root
$envFile = if (Test-Path (Join-Path $scriptDir $envFileName)) {
    Join-Path $scriptDir $envFileName
} else {
    Join-Path $projectRoot $envFileName
}

# ── Bei benannten Environments zusaetzlich .env.local laden (Basis-Konfiguration)
$baseEnvFile = $null
if ($Environment -ne "default") {
    $baseCandidate = if (Test-Path (Join-Path $scriptDir ".env.local")) {
        Join-Path $scriptDir ".env.local"
    } elseif (Test-Path (Join-Path $projectRoot ".env.local")) {
        Join-Path $projectRoot ".env.local"
    } else { $null }
    if ($baseCandidate) { $baseEnvFile = $baseCandidate }
}

# ── Pruefen ob Datei existiert
if (-not (Test-Path $envFile)) {
    Write-Warning "Env-Datei nicht gefunden: $envFile"
    $exampleInConfig = Join-Path $scriptDir ($envFileName -replace '\.local$', '.example')
    $exampleInRoot   = Join-Path $projectRoot ($envFileName -replace '\.local$', '.example')
    $exampleHint = if (Test-Path $exampleInConfig) { $exampleInConfig } else { $exampleInRoot }
    Write-Host "Beispiel-Datei vorhanden: $exampleHint" -ForegroundColor Yellow
    Write-Host "Bitte als '$envFileName' in config/ ablegen und Werte befuellen." -ForegroundColor Yellow
    return
}

function Load-EnvFile($filePath) {
    $lineCount = 0
    $variableCount = 0
    Write-Host "`n=== Lade Umgebungsvariablen aus $([System.IO.Path]::GetFileName($filePath)) ===" -ForegroundColor Cyan
    Get-Content $filePath | Where-Object { $_ -and -not $_.StartsWith("#") } | ForEach-Object {
        $lineCount++
        $line = ($_ -replace '#.*$', '').Trim()
        if ($line -and $line -match '^([A-Z_][A-Z0-9_]*)=(.*)$') {
            $key = $matches[1]
            $value = $matches[2]
            [System.Environment]::SetEnvironmentVariable($key, $value, "Process")
            $variableCount++
            $displayValue = if ($key -match 'PASSWORD|SECRET|TOKEN|CREDENTIAL') { "***" } else { $value }
            Write-Host "  $key = $displayValue" -ForegroundColor Green
        }
    }
    Write-Host "`nGeladen: $variableCount Variable(n) von $lineCount Zeile(n)`n"
}

# Basis (.env.local) zuerst laden, dann environment-spezifische Datei (ueberschreibt Basis)
if ($baseEnvFile) {
    Load-EnvFile $baseEnvFile
}
Load-EnvFile $envFile

# ── Validierung der kritischen Variablen
$criticalVars = @(
    "ZEUS_OUTPUT_ROOT",
    "ZEUS_SOURCE_ROOT",
    "ZEUS_DB_HOST",
    "ZEUS_DB_USER",
    "ZEUS_DB_PASSWORD"
)

if ($Environment -eq "project") {
    $criticalVars = @(
        # Fetch (Sourcen von IBM i holen) — typisch SYS_TEST
        "ZEUS_FETCH_HOST",
        "ZEUS_FETCH_PORT",
        "ZEUS_FETCH_USER",
        "ZEUS_FETCH_PASSWORD",
        "ZEUS_FETCH_IFS_DIR",
        "ZEUS_FETCH_OUT",
        # DB-Standardverbindung
        "ZEUS_DB_HOST",
        "ZEUS_DB_USER",
        "ZEUS_DB_PASSWORD"
        # Hinweis: ZEUS_METADATA_DB_HOST ist optional fuer Multi-Maschinen-Setup
        # (z.B. SYS_PROD fuer Metadaten) — kein Pflichtfeld, da Fallback auf ZEUS_DB_HOST
    )
}

$missing = @()
foreach ($var in $criticalVars) {
    $value = [System.Environment]::GetEnvironmentVariable($var, "Process")
    if (-not $value -or $value -eq "") {
        $missing += $var
    }
}

if ($Environment -eq "project") {
    $sourceLib = [System.Environment]::GetEnvironmentVariable("ZEUS_FETCH_SOURCE_LIB", "Process")
    $sourceLibrary = [System.Environment]::GetEnvironmentVariable("ZEUS_FETCH_SOURCE_LIBRARY", "Process")
    if ((-not $sourceLib -or $sourceLib -eq "") -and (-not $sourceLibrary -or $sourceLibrary -eq "")) {
        $missing += "ZEUS_FETCH_SOURCE_LIB|ZEUS_FETCH_SOURCE_LIBRARY"
    }
}

if ($missing.Count -gt 0) {
    Write-Warning "Kritische Variablen nicht gesetzt:"
    $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    Write-Host "`nBitte .env-Datei ueberpruefen!`n" -ForegroundColor Yellow
} else {
    Write-Host "Alle kritischen Variablen sind gesetzt. KI-Chat kann jetzt verwendet werden." -ForegroundColor Green
}
