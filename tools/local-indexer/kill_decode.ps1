${ErrorActionPreference} = 'SilentlyContinue'

# Resolve repo root
$repo = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
if (-not $repo) { $repo = 'c:\EF-Map-main' }

# Resolve pid file
$pidFile = if ($env:DECODE_PID_PATH) { $env:DECODE_PID_PATH } else { Join-Path $repo 'data\local-indexer-decode.pid' }
try { $pidFile = (Resolve-Path -Path $pidFile -ErrorAction SilentlyContinue).Path } catch {}

$killed = $false

# Prefer killing by PID from pid file
if ($pidFile -and (Test-Path -Path $pidFile)) {
  try {
    $pidText = Get-Content -Path $pidFile -Raw -ErrorAction SilentlyContinue
    $pidNum = [int]($pidText.Trim())
    if ($pidNum -gt 0) {
      $proc = Get-Process -Id $pidNum -ErrorAction SilentlyContinue
      if ($proc) {
        Write-Output ("Killing decode PID from file: " + $pidNum)
        Stop-Process -Id $pidNum -Force -ErrorAction SilentlyContinue
        $killed = $true
      }
    }
  } catch {}
}

# Fallback: kill any node.exe running decode_apply.js by command line regex
if (-not $killed) {
  $regex = 'tools\\local-indexer\\decode_apply.js'
  $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match $regex }
  if ($procs) {
    foreach ($p in $procs) {
      Write-Output ("Killing decode by regex PID=" + $p.ProcessId)
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
      $killed = $true
    }
  } else {
    Write-Output 'No decode_apply.js process found by regex'
  }
}

# Cleanup pid file
try { if ($pidFile -and (Test-Path -Path $pidFile)) { Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue } } catch {}

if ($killed) {
  Write-Output 'Decode process terminated.'
} else {
  Write-Output 'No decode process was terminated.'
}
