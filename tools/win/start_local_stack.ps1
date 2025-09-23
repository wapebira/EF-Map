<#
  start_local_stack.ps1
  Purpose: On boot, ensure Docker engine is up, then start the local Primodium indexer stack and helpers.
  Safe to run multiple times (idempotent-ish). Intended to run as SYSTEM via a Scheduled Task (At startup).

  Behavior:
  - Start com.docker.service (Docker engine), set to Automatic
  - Wait for Docker to be ready (uses existing wait_for_docker_ready.ps1 if available)
  - Start the pg-indexer stack (Postgres + writer/reader)
  - Optionally start the head poller and Grafana
  - Logs a brief summary to scratch/startup_*.log
#>
Param(
  [switch]$StartGrafana,
  [switch]$StartHeadPoller,
  [int]$TimeoutSec = 300,
  # Optional: network params for the indexer; defaults target Pyrope chain
  [string]$RpcHttpUrl = 'https://rpc.pyropechain.com',
  [int]$ChainId = 695569,
  [string]$WorldAddress = '0xD7c454e1A9aD1601fd7748C1a33F2aE289E0C1DD',
  [long]$StartBlock = 7288348
)

$ErrorActionPreference = 'Stop'

# Resolve repo root and log file
try {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
} catch {
  $repoRoot = $PSScriptRoot
}
$scratchDir = Join-Path $repoRoot 'scratch'
if (-not (Test-Path $scratchDir)) { New-Item -Path $scratchDir -ItemType Directory -Force | Out-Null }
$global:StartupLogFile = Join-Path $scratchDir ("startup_" + (Get-Date -Format 'yyyyMMdd_HHmmss') + ".log")

function Write-Log($msg) {
  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  $line = "[$stamp] $msg"
  Write-Host $line
  try { Add-Content -Path $global:StartupLogFile -Value $line -ErrorAction SilentlyContinue } catch {}
}

try {
  # Ensure we are in repo root
  Set-Location $repoRoot

  Write-Log "Starting local stack from $repoRoot as $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)"

  # 1) Ensure Docker engine service is set to Automatic and running
  $svcName = 'com.docker.service'
  try {
    $svc = Get-Service -Name $svcName -ErrorAction Stop
    if ($svc.StartType -ne 'Automatic') {
      Write-Log "Setting $svcName StartType to Automatic"
      Set-Service -Name $svcName -StartupType Automatic
    }
    if ($svc.Status -ne 'Running') {
      Write-Log "Starting $svcName"
      Start-Service -Name $svcName
    }
  } catch {
    Write-Log "Warning: Could not manage $svcName ($_)"
  }

  # 2) Wait for docker to be ready
  $waitScript = Join-Path $PSScriptRoot 'wait_for_docker_ready.ps1'
  if (Test-Path $waitScript) {
    Write-Log "Waiting for Docker engine to be ready (timeout ${TimeoutSec}s)"
    & powershell -NoProfile -ExecutionPolicy Bypass -File $waitScript -TimeoutSeconds $TimeoutSec -PollSeconds 3
  } else {
    Write-Log "wait_for_docker_ready.ps1 not found, probing docker CLI directly"
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    do {
      try {
        $null = docker version --format '{{.Server.Version}}' 2>$null
        if ($LASTEXITCODE -eq 0) { break }
      } catch {}
      Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $deadline)
  }

  # 3) Start Primodium pg-indexer stack
  $startPg = Join-Path $PSScriptRoot 'start_pg_indexer_stack.ps1'
  if (Test-Path $startPg) {
    Write-Log "Starting pg-indexer stack"
    & powershell -NoProfile -ExecutionPolicy Bypass -File $startPg -RpcHttpUrl $RpcHttpUrl -ChainId $ChainId -WorldAddress $WorldAddress -StartBlock $StartBlock
  } else {
    Write-Log "start_pg_indexer_stack.ps1 not found; skipping"
  }

  # 4) Optionally start head poller
  if ($StartHeadPoller.IsPresent -or -not $PSBoundParameters.ContainsKey('StartHeadPoller')) {
    $startHead = Join-Path $PSScriptRoot 'start_head_poller.ps1'
    if (Test-Path $startHead) {
      Write-Log "Starting head poller"
      & powershell -NoProfile -ExecutionPolicy Bypass -File $startHead
    } else {
      Write-Log "start_head_poller.ps1 not found; skipping"
    }
  }

  # 5) Optionally start Grafana (if not already running)
  if ($StartGrafana.IsPresent -or -not $PSBoundParameters.ContainsKey('StartGrafana')) {
    try {
      $running = (docker ps --format '{{.Names}}' | Where-Object { $_ -eq 'ef-grafana' })
      if (-not $running) {
        $startGraf = Join-Path $PSScriptRoot 'start_grafana.ps1'
        if (Test-Path $startGraf) {
          Write-Log "Starting Grafana"
          & powershell -NoProfile -ExecutionPolicy Bypass -File $startGraf
        } else {
          Write-Log "start_grafana.ps1 not found; skipping Grafana"
        }
      } else {
        Write-Log "Grafana already running"
      }
    } catch {
      Write-Log "Warning: could not verify/start Grafana ($_)"
    }
  }

  # 6) Brief status summary
  try {
    $names = docker ps --format '{{.Names}}\t{{.Status}}'
    Write-Log ("Containers up:\n" + ($names -join "`n"))
  } catch {}

  Write-Log "Local stack startup script completed"
} catch {
  Write-Log "ERROR: $_"
  exit 1
}
