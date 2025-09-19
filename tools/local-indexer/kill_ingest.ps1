${ErrorActionPreference} = 'SilentlyContinue'

# Resolve pid file
$pidFile = Join-Path $PSScriptRoot '..' '..' 'data' 'local-indexer-ingest.pid'
try { $pidFile = (Resolve-Path -Path $pidFile -ErrorAction SilentlyContinue).Path } catch {}

$killed = $false

# Prefer killing by PID from pid file
if (Test-Path -Path $pidFile) {
  try {
    $pidText = Get-Content -Path $pidFile -Raw -ErrorAction SilentlyContinue
    $pidNum = [int]($pidText.Trim())
    if ($pidNum -gt 0) {
      $proc = Get-Process -Id $pidNum -ErrorAction SilentlyContinue
      if ($proc) {
        Write-Output ("Killing PID from file: " + $pidNum)
        Stop-Process -Id $pidNum -Force -ErrorAction SilentlyContinue
        $killed = $true
      }
    }
  } catch {}
}

# Fallback: kill any node.exe running ingest_raw.js by command line regex
if (-not $killed) {
  $regex = 'tools\\local-indexer\\ingest_raw.js'
  $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match $regex }
  if ($procs) {
    foreach ($p in $procs) {
      Write-Output ("Killing PID by regex " + $p.ProcessId)
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
      $killed = $true
    }
  } else {
    Write-Output 'No ingest_raw.js process found by regex'
  }
}

# Cleanup pid file
try { if (Test-Path -Path $pidFile) { Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue } } catch {}

if ($killed) {
  Write-Output 'Ingest process terminated.'
} else {
  Write-Output 'No ingest process was terminated.'
}
