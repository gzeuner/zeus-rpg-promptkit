$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path (Join-Path $ScriptDir "..\..\..")
Set-Location $RootDir

if (-not (Test-Path "node_modules")) {
  Write-Error "Missing node_modules. Run: npm install"
}

node cli/zeus.js analyze `
  --source ./examples/demo-rpg-mini-system/rpg_sources `
  --program PROGRAM_100 `
  --out ./examples/demo-rpg-mini-system/output-baseline `
  --mode documentation `
  --optimize-context `
  --reproducible

if (Test-Path "./examples/demo-rpg-mini-system/output-baseline/.zeus-cache") {
  Remove-Item "./examples/demo-rpg-mini-system/output-baseline/.zeus-cache" -Recurse -Force
}

Write-Host "Demo analyze run completed."
