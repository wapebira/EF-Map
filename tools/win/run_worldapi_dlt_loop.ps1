param(
  [int]$IntervalSec = 900,
  [string]$PipelineDir = "c:/EF-Map-main/tools/worldapi-pipeline/worldapi/worldapi_pipeline",
  [string]$LogDir = "c:/EF-Map-main",
  [switch]$Once
)

$ErrorActionPreference = 'Stop'

# Ensure paths
if (-not (Test-Path $PipelineDir)) { throw "PipelineDir not found: $PipelineDir" }
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }

$pidFile = Join-Path $LogDir 'tmp_worldapi_loop.pid'
$stopFile = Join-Path $LogDir 'tmp_worldapi_loop.stop'

Set-Content -Path $pidFile -Value $PID -Encoding ascii
Write-Host "[worldapi-loop] started pid=$PID interval=${IntervalSec}s"

function Invoke-Once {
  Push-Location $PipelineDir
  try {
    # Activate venv if present
    if (Test-Path ./.venv/Scripts/Activate.ps1) { . ./.venv/Scripts/Activate.ps1 }
    $env:PYTHONIOENCODING = 'utf8'
    # Pick Python: prefer venv python, then py launcher, then system python
    $python = $null
    if (Test-Path ./.venv/Scripts/python.exe) { $python = (Resolve-Path ./.venv/Scripts/python.exe).Path }
    elseif (Get-Command py -ErrorAction SilentlyContinue) { $python = 'py -3' }
    elseif (Get-Command python -ErrorAction SilentlyContinue) { $python = (Get-Command python).Source }
    else { throw 'Python not found (venv, py, or python missing)' }
    $ts = Get-Date -Format yyyyMMdd_HHmmss
    $log = Join-Path $LogDir ("tmp_worldapi_run_" + $ts + ".log")
    Write-Host "[worldapi-loop] running pipeline → $log"
    # Run synchronously once, capture output to log and echo to console
    # Use Start-Process to ensure stderr is merged and timing consistent
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $pwshExe
    # Build a command that runs the chosen python and tees output
    $cmd = "$python worldapi_pipeline.py 2>&1 | Tee-Object -FilePath '$log'"
    # Simpler: invoke via powershell -Command to support 'py -3' form
    powershell -NoProfile -ExecutionPolicy Bypass -Command $cmd
  }
  finally {
    Pop-Location
  }
}

do {
  if (Test-Path $stopFile) {
    Write-Host "[worldapi-loop] stop file detected → $(Get-Date)"; break
  }
  Invoke-Once
  if ($Once) { break }
  Start-Sleep -Seconds $IntervalSec
} while ($true)

Remove-Item -ErrorAction SilentlyContinue $pidFile
Write-Host "[worldapi-loop] exited"
