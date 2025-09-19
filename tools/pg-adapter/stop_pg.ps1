$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
  docker compose -f "$PSScriptRoot/docker-compose.yml" down -v
  Write-Host "[pg] down" -ForegroundColor Yellow
} finally {
  Pop-Location
}
