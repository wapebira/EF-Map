param(
  [int]$Port = 5432
)
$ErrorActionPreference = 'Stop'
Write-Host "[pg] starting docker postgres on port $Port..."
Push-Location $PSScriptRoot
try {
  docker compose -f "$PSScriptRoot/docker-compose.yml" up -d
  Write-Host "[pg] up" -ForegroundColor Green
} finally {
  Pop-Location
}
