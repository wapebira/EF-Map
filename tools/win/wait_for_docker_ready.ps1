param(
  [int]$TimeoutSeconds = 180,
  [int]$PollSeconds = 3
)
$ErrorActionPreference = 'SilentlyContinue'

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
Write-Host ("[docker] Waiting up to {0}s for engine..." -f $TimeoutSeconds)
do {
  Start-Sleep -Seconds $PollSeconds
  $ver = docker info --format '{{.ServerVersion}}'
  if ($LASTEXITCODE -eq 0 -and $ver) {
    Write-Host ("[docker] Ready. ServerVersion={0}" -f $ver) -ForegroundColor Green
    exit 0
  }
} while ((Get-Date) -lt $deadline)

Write-Error '[docker] Engine not ready before timeout.'
exit 1
