param(
  [int]$Port = 8733
)

Write-Output ("[restart] target port=" + $Port)

# Kill any existing listener on the port
try {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $conn) {
    $pid = $conn.OwningProcess
    Write-Output ("[restart] killing PID " + $pid)
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
  } else {
    Write-Output "[restart] no existing listener"
  }
} catch {
  Write-Output ("[restart] kill step error: " + $_.Exception.Message)
}

# Compute repo root relative to this script
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
Set-Location $repoRoot
Write-Output ("[restart] repo=" + $repoRoot)

# Start the metrics server hidden
$env:PORT = "$Port"
Write-Output ("[restart] starting metrics server on http://127.0.0.1:" + $Port)
Start-Process -FilePath node -ArgumentList 'tools/local-indexer/start_metrics.js' -WindowStyle Hidden

# Wait briefly for readiness
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 250
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:" + $Port + "/api/health") -TimeoutSec 2
    if ($resp.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
}

if ($ready) {
  Write-Output ("[restart] READY on port " + $Port)
} else {
  Write-Output "[restart] started but health not reachable yet"
}
$ErrorActionPreference = 'SilentlyContinue'
param(
  [int]$Port = 8733
)

# Kill existing metrics_server.js processes
try {
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -match 'metrics_server.js' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
} catch {}

# Start fresh on the requested port
$repo = 'c:\EF-Map-main'
$node = 'node'
$script = Join-Path $repo 'tools\local-indexer\metrics_server.js'

Start-Process -FilePath $node -ArgumentList @($script, '--port', $Port) -WorkingDirectory $repo -WindowStyle Hidden | Out-Null
Write-Output ("metrics_server restarted on http://localhost:" + $Port)
*** End Patch