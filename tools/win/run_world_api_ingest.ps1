Param(
  [string]$EnvFile = ".env",
  [string]$Node = "node",
  [string]$Script = "tools/world_api/ingest_world_api.js"
)

$ErrorActionPreference = 'Stop'
if (Test-Path $EnvFile) {
  Write-Host "Loading env from $EnvFile"
  foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^[#\s]') { continue }
    if ($line -notmatch '=') { continue }
    $kv = $line.Split('=',2)
    $k = $kv[0].Trim()
    $v = $kv[1]
    if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length-2) }
    [System.Environment]::SetEnvironmentVariable($k, $v)
  }
}

& $Node $Script
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
