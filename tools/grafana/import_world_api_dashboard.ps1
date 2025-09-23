param(
  [string]$GrafanaUrl = "http://localhost:3000",
  [string]$DashboardPath = "$(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'world_api_minimal_dashboard.json'))"
)

Write-Host "Grafana URL:" $GrafanaUrl
if (-not (Test-Path -LiteralPath $DashboardPath)) {
  Write-Error "Dashboard file not found: $DashboardPath"
  exit 1
}

function Read-ApiToken {
  $sec = Read-Host -AsSecureString -Prompt "Operator: paste Grafana API token (optional; Enter to skip)"
  if (-not $sec) { return $null }
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}

function Read-BasicCreds {
  $user = Read-Host -Prompt "Grafana username"
  $sec = Read-Host -AsSecureString -Prompt "Grafana password (hidden)"
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  $pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto($p)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)
  return @{ user = $user; pass = $pass }
}

function Get-Headers($token, $basic) {
  if ($token) { return @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' } }
  if ($basic) {
    $bytes = [Text.Encoding]::UTF8.GetBytes("$($basic.user):$($basic.pass)")
    $b64 = [Convert]::ToBase64String($bytes)
    return @{ Authorization = "Basic $b64"; 'Content-Type' = 'application/json' }
  }
  throw "No authentication configured"
}

$token = Read-ApiToken
$headers = $null
$dsList = $null
if ($token) {
  try {
    $headers = Get-Headers -token $token -basic $null
    $dsList = Invoke-RestMethod -Method GET -Uri "$GrafanaUrl/api/datasources" -Headers $headers
  } catch {
    Write-Warning "Token auth failed: $($_.Exception.Message). Will try Basic auth."
  }
}
if (-not $dsList) {
  $basic = Read-BasicCreds
  try {
    $headers = Get-Headers -token $null -basic $basic
    $dsList = Invoke-RestMethod -Method GET -Uri "$GrafanaUrl/api/datasources" -Headers $headers
  } catch {
    Write-Error "Failed to list Grafana datasources with Basic auth. $_"
    exit 1
  }
}

$pg = $dsList | Where-Object { $_.type -eq 'postgres' } | Select-Object -First 1
if (-not $pg) {
  Write-Error "No PostgreSQL datasource found in Grafana. Create one, then re-run."
  exit 1
}
Write-Host "Using Postgres datasource:" $pg.name "UID:" $pg.uid

$dashRaw = Get-Content -LiteralPath $DashboardPath -Raw
$dash = $dashRaw | ConvertFrom-Json

# Ensure 'id' is absent for import
if ($dash.PSObject.Properties.Name -contains 'id') { $dash.PSObject.Properties.Remove('id') }

$inputs = @(@{ name = 'DS_WORLDAPI_PG'; type = 'datasource'; pluginId = 'postgres'; value = $pg.name })

$body = @{ dashboard = $dash; overwrite = $true; folderId = 0; inputs = $inputs } | ConvertTo-Json -Depth 64

try {
  # Use import endpoint so inputs mapping is honored
  $resp = Invoke-RestMethod -Method POST -Uri "$GrafanaUrl/api/dashboards/import" -Headers $headers -Body $body
  Write-Host "Imported dashboard UID:" ($resp.uid) "status:" ($resp.status)
  if ($resp.uid) { Write-Host "Open:" "$GrafanaUrl/d/$($resp.uid)" }
} catch {
  Write-Error "Import failed. $_"
  exit 1
}
