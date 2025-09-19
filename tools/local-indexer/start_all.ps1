param(
  [int]$StatusPort = 8736,
  [int]$MetricsPort = 8733,
  [int]$ControlPort = 8799,
  [int]$OrchPort = 8798
)

$ErrorActionPreference = 'SilentlyContinue'
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $repo

try { New-Item -ItemType Directory -Force -Path "$repo\data" | Out-Null } catch {}
try { New-Item -ItemType Directory -Force -Path "$repo\scratch" | Out-Null } catch {}

# Kill any prior orchestrator and services; free ports
try {
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -match 'local-indexer\\orchestrator.js' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'local-indexer\\status_server.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'local-indexer\\metrics_server.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'local-indexer\\control_server.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'local-indexer\\ingest_raw.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'local-indexer\\decode_apply.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}

foreach ($p in @($StatusPort, $MetricsPort, $ControlPort, $OrchPort)) {
  try { $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } } catch {}
}

$env:STATUS_PORT = "$StatusPort"
$env:PORT = "$MetricsPort"
$env:CONTROL_PORT = "$ControlPort"
$env:ORCH_PORT = "$OrchPort"
$env:ORCH_ENABLE = '1'

$logOut = "$repo\scratch\orchestrator.out.log"
$logErr = "$repo\scratch\orchestrator.err.log"

$p = Start-Process -FilePath node -ArgumentList 'tools/local-indexer/orchestrator.js' -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput $logOut -RedirectStandardError $logErr
if ($p -and $p.Id) { Write-Output ("orchestrator_started pid=" + $p.Id) } else { Write-Output 'orchestrator_failed'; exit 1 }

# Brief readiness probe (metrics + status)
Start-Sleep -Milliseconds 700
try {
  $s = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:"+$StatusPort+"/api/health") -TimeoutSec 3
  $m = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:"+$MetricsPort+"/api/health") -TimeoutSec 3
  Write-Output ("status="+$s.StatusCode+" metrics="+$m.StatusCode)
} catch { Write-Output 'partial_ready' }
