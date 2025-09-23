param(
  [string]$NodeDir = "C:\nvm4w\nodejs",
  [string]$IndexerDir = "C:\primodium-indexer\indexer-main"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path (Join-Path $NodeDir 'node.exe'))) {
  Write-Host "[indexer] node.exe not found in NodeDir: $NodeDir" -ForegroundColor Red
  exit 1
}

$corepack = Join-Path $NodeDir 'corepack.cmd'
if (-not (Test-Path $corepack)) {
  Write-Host "[indexer] corepack.cmd not found in NodeDir: $NodeDir" -ForegroundColor Red
  exit 1
}

# Put Node first on PATH for this process and children
$env:PATH = "$NodeDir;" + $env:PATH

& (Join-Path $NodeDir 'node.exe') -v
& $corepack enable
& $corepack prepare pnpm@8.15.9 --activate
& $corepack pnpm -v

Push-Location $IndexerDir
try {
  Write-Host "[indexer] starting via pnpm indexer:local" -ForegroundColor Cyan
  & $corepack pnpm indexer:local
} finally {
  Pop-Location
}
