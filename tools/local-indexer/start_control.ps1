$ErrorActionPreference = 'SilentlyContinue'

param(
  [int]$Port = 8799
)

$repo = 'c:\EF-Map-main'
Set-Location $repo

# Kill any existing control_server.js instances
try {
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -match 'control_server.js' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}

$env:CONTROL_PORT = "$Port"
Start-Process -FilePath node -ArgumentList 'tools/local-indexer/control_server.js' -WorkingDirectory $repo -WindowStyle Hidden | Out-Null

# Wait for health
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 250
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:" + $Port + "/health") -TimeoutSec 2
    if ($resp.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
}
if ($ready) { Write-Output ("control server READY on http://127.0.0.1:" + $Port) } else { Write-Output "control server started, health not reachable yet" }
