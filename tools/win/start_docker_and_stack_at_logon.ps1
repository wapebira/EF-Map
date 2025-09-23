<#
  start_docker_and_stack_at_logon.ps1
  Purpose: On user logon, ensure Docker Desktop UI is started in the user session, wait for the engine, then start the local stack.
  Run via a Scheduled Task with trigger ONLOGON for the target user.
#>
param(
  [int]$TimeoutSec = 300
)
$ErrorActionPreference = 'Stop'

function Wait-DockerEngine([int]$timeoutSec) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  do {
    try {
      docker version --format '{{.Server.Version}}' 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { return $true }
    } catch {}
    Start-Sleep -Seconds 3
  } while ((Get-Date) -lt $deadline)
  return $false
}

Write-Host "[logon] Launching Docker Desktop in background (if not running)"
try {
  $ddExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
  if (Test-Path $ddExe) {
    # Launch minimized/background; ignore if already running
    if (-not (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue)) {
      Start-Process -FilePath $ddExe -ArgumentList '--background' -WindowStyle Minimized
    }
  }
} catch {}

Write-Host "[logon] Waiting for Docker engine..."
if (-not (Wait-DockerEngine -timeoutSec $TimeoutSec)) {
  Write-Warning "Docker engine did not become ready within $TimeoutSec seconds."
}

Write-Host "[logon] Starting local stack"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start_local_stack.ps1')
