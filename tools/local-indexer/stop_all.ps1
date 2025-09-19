param(
  [int]$StatusPort = 8736,
  [int]$MetricsPort = 8733,
  [int]$ControlPort = 8799,
  [int]$OrchPort = 8798
)

$ErrorActionPreference = 'SilentlyContinue'

# Kill orchestrator first
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'local-indexer\\orchestrator.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# Kill services by script name
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'local-indexer\\status_server.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'local-indexer\\metrics_server.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'local-indexer\\control_server.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'local-indexer\\ingest_raw.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'local-indexer\\decode_apply.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# Free ports (best-effort)
foreach ($p in @($StatusPort, $MetricsPort, $ControlPort, $OrchPort)) {
  try {
    $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
  } catch {}
}

Write-Output "stopped"
