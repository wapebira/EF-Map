$ErrorActionPreference = 'SilentlyContinue'
param(
  [Nullable[int]]$MaxMs,
  [Nullable[int]]$MaxRows
)
# Respect explicit zeros: only set defaults if the parameters were not provided
if ($null -eq $MaxMs) { $MaxMs = 0 }
if ($null -eq $MaxRows) { $MaxRows = 0 }

$repo = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
if (-not $repo) { $repo = 'c:\EF-Map-main' }

$env:LOCAL_DB_PATH           = if ($env:LOCAL_DB_PATH) { $env:LOCAL_DB_PATH } else { Join-Path $repo 'data\local-indexer.db' }
$env:STATUS_PATH             = if ($env:STATUS_PATH) { $env:STATUS_PATH } else { Join-Path $repo 'data\local-indexer-status.json' }
$env:DECODE_HISTORY_PATH     = if ($env:DECODE_HISTORY_PATH) { $env:DECODE_HISTORY_PATH } else { Join-Path $repo 'data\local-indexer-decode-history.json' }
$env:CONTROL_PATH            = if ($env:CONTROL_PATH) { $env:CONTROL_PATH } else { Join-Path $repo 'data\local-indexer-control.json' }
$env:DECODE_PID_PATH         = if ($env:DECODE_PID_PATH) { $env:DECODE_PID_PATH } else { Join-Path $repo 'data\local-indexer-decode.pid' }
$env:DECODE_MAX_MS           = [string]$MaxMs
$env:DECODE_MAX_ROWS         = [string]$MaxRows

# Clear any lingering stop flag so a fresh run doesn't immediately exit
try {
  if (Test-Path $env:CONTROL_PATH) {
    Remove-Item -Path $env:CONTROL_PATH -Force -ErrorAction SilentlyContinue
  }
} catch {}

if ($MaxMs -eq 0 -and $MaxRows -eq 0) {
  Write-Output "Starting FULL decode: no time/row caps"
} else {
  Write-Output ("Starting decode: MaxMs=" + $MaxMs + " MaxRows=" + $MaxRows)
}

$node = 'node'
$script = (Join-Path $repo 'tools\local-indexer\decode_apply.js')
$p = Start-Process -FilePath $node -ArgumentList $script -WorkingDirectory $repo -WindowStyle Hidden -PassThru
if ($p -and $p.Id) { Write-Output ("Decode PID=" + $p.Id) }
exit 0