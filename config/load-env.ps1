# load-env.ps1
# Laedt Umgebungsvariablen aus .env-Dateien in die aktuelle PowerShell-Session
#
# Einmalige Freigabe (kein Admin noetig, nur fuer den aktuellen User):
#   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
#
# Per-Session-Bypass (kein Admin, keine dauerhafte Policy-Aenderung, Standardweg im Team):
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   . .\config\load-env.ps1 -Environment ders
#   HINWEIS: Diese Einstellung gilt nur fuer das aktuelle Terminalfenster.
#            Bei jedem neuen Terminal wiederholen.
#
# Verwendung danach (Dot-Sourcing, damit die Variablen in der Session bleiben):
#   . .\config\load-env.ps1                    # Laedt config/.env.local
#   . .\config\load-env.ps1 -Environment project  # Laedt config/.env.project.local
#
# Multi-Maschinen-Setup (Sourcen von DEV_IBM_I_HOST, Metadaten von READONLY_IBM_I_HOST):
#   In .env.project.local einfach ZEUS_METADATA_DB_HOST=READONLY_IBM_I_HOST setzen.
#   Da Env-Vars immer Vorrang vor Profilwerten haben, genuegt das.
#   Beispiel:
#     ZEUS_FETCH_HOST=DEV_IBM_I_HOST       <- Sourcen von Entwicklungs- oder Testsystem
#     ZEUS_DB_HOST=DEV_IBM_I_HOST          <- DB-Default (Fallback)
#     ZEUS_METADATA_DB_HOST=READONLY_IBM_I_HOST  <- Metadaten/Analysen von Read-only-System
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
#   Bevorzugter Speicherort ist config/local-only/ (gitignoriert, neben profiles.json).
#   Fallback: config/ (neben diesem Skript) und Projekt-Root (rueckwaertskompatibel).

param(
    [string]$Environment = "default"
)

$ErrorActionPreference = "Stop"

function Stop-LoadEnv {
    param(
        [string]$Message,
        [int]$ExitCode = 1
    )

    $global:LASTEXITCODE = $ExitCode
    Write-Error $Message
    throw $Message
}

function Test-NonEmptyEnvVar {
    param(
        [string]$Name
    )

    $value = [System.Environment]::GetEnvironmentVariable($Name, "Process")
    return -not [string]::IsNullOrWhiteSpace($value)
}

$effectiveExecutionPolicy = (Get-ExecutionPolicy) 2>$null
if ($effectiveExecutionPolicy) {
    Write-Host "ExecutionPolicy: $effectiveExecutionPolicy" -ForegroundColor DarkCyan
    if ($effectiveExecutionPolicy -in @("Restricted", "AllSigned")) {
        Write-Warning "Die aktuelle ExecutionPolicy ($effectiveExecutionPolicy) kann das Laden dieses Skripts blockieren oder teilweise verhindern."
        Write-Host "Tipp fuer diese Session: Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force" -ForegroundColor Yellow
    }
}

# ── Datei-Pfade bestimmen
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$envFileName = if ($Environment -eq "default") { ".env.local" } else { ".env.$Environment.local" }
# Suche zuerst im config/local-only/-Verzeichnis (bevorzugter Ort fuer gitignorierte
# Credentials), dann im config/-Verzeichnis, dann im Projekt-Root.
$localOnlyDir = Join-Path $scriptDir 'local-only'
$envFile = if (Test-Path (Join-Path $localOnlyDir $envFileName)) {
    Join-Path $localOnlyDir $envFileName
} elseif (Test-Path (Join-Path $scriptDir $envFileName)) {
    Join-Path $scriptDir $envFileName
} else {
    Join-Path $projectRoot $envFileName
}

# ── Bei benannten Environments zusaetzlich .env.local laden (Basis-Konfiguration)
$baseEnvFile = $null
if ($Environment -ne "default") {
    $baseCandidate = if (Test-Path (Join-Path $localOnlyDir ".env.local")) {
        Join-Path $localOnlyDir ".env.local"
    } elseif (Test-Path (Join-Path $scriptDir ".env.local")) {
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
    Write-Host "Bitte als '$envFileName' in config/local-only/ (bevorzugt) oder config/ ablegen und Werte befuellen." -ForegroundColor Yellow
    Stop-LoadEnv "Env-Datei fehlt: $envFileName" 2
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
    "ZEUS_DB_USER",
    "ZEUS_DB_PASSWORD"
)

$alternativeCriticalGroups = @(
    @{ Label = "ZEUS_DB_HOST|ZEUS_DB_URL"; Variables = @("ZEUS_DB_HOST", "ZEUS_DB_URL") }
)

if ($Environment -eq "project") {
    $criticalVars = @(
        # Fetch (Sourcen von IBM i holen) — typisch DEV_IBM_I_HOST
        "ZEUS_FETCH_HOST",
        "ZEUS_FETCH_PORT",
        "ZEUS_FETCH_USER",
        "ZEUS_FETCH_PASSWORD",
        "ZEUS_FETCH_IFS_DIR",
        "ZEUS_FETCH_OUT",
        # DB-Standardverbindung
        "ZEUS_DB_USER",
        "ZEUS_DB_PASSWORD"
        # Hinweis: ZEUS_METADATA_DB_HOST ist optional fuer Multi-Maschinen-Setup
        # (z.B. READONLY_IBM_I_HOST fuer Metadaten) — kein Pflichtfeld, da Fallback auf ZEUS_DB_HOST
    )

    $alternativeCriticalGroups = @(
        @{ Label = "ZEUS_DB_HOST|ZEUS_DB_URL"; Variables = @("ZEUS_DB_HOST", "ZEUS_DB_URL") }
    )
}

$missing = @()
foreach ($var in $criticalVars) {
    if (-not (Test-NonEmptyEnvVar $var)) {
        $missing += $var
    }
}

foreach ($group in $alternativeCriticalGroups) {
    $hasValue = $false
    foreach ($candidate in $group.Variables) {
        if (Test-NonEmptyEnvVar $candidate) {
            $hasValue = $true
            break
        }
    }
    if (-not $hasValue) {
        $missing += $group.Label
    }
}

if ($Environment -eq "project") {
    if ((-not (Test-NonEmptyEnvVar "ZEUS_FETCH_SOURCE_LIB")) -and (-not (Test-NonEmptyEnvVar "ZEUS_FETCH_SOURCE_LIBRARY"))) {
        $missing += "ZEUS_FETCH_SOURCE_LIB|ZEUS_FETCH_SOURCE_LIBRARY"
    }
}

if ($missing.Count -gt 0) {
    Write-Warning "Kritische Variablen fehlen oder sind leer:"
    $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    Write-Host "`nBitte .env-Datei und ggf. ExecutionPolicy pruefen." -ForegroundColor Yellow
    Write-Host "Falls das Skript wegen PowerShell-Richtlinien nicht sauber geladen wurde:" -ForegroundColor Yellow
    Write-Host "  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force" -ForegroundColor Yellow
    Stop-LoadEnv "Pflichtvariablen fehlen oder sind leer. Secrets wurden nicht ausgegeben." 3
} else {
    Write-Host "Alle kritischen Variablen sind gesetzt. KI-Chat kann jetzt verwendet werden." -ForegroundColor Green
}
