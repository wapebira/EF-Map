param(
  [string]$RepoDir = 'C:\primodium-indexer\indexer-main\packages\pg-indexer-reader',
  [string]$RpcHttpUrl,
  [int]$ChainId,
  [string]$WorldAddress,
  [long]$StartBlock,
  # Tuning knobs supported by Primodium store-indexer writer (via env)
  # FOLLOW_BLOCK_TAG: one of 'latest' | 'safe' | 'finalized'
  [ValidateSet('latest','safe','finalized')]
  [string]$FollowBlockTag,
  # POLLING_INTERVAL in milliseconds (controls viem public client polling)
  [int]$PollingIntervalMs,
  # MAX_BLOCK_RANGE for batch fetches (number of blocks per request)
  [int]$MaxBlockRange
)
$ErrorActionPreference = 'Stop'

# Ensure Docker engine is up
$waitScript = Join-Path $PSScriptRoot 'wait_for_docker_ready.ps1'
& $waitScript -TimeoutSeconds 240 -PollSeconds 3

Push-Location $RepoDir
try {
  # Compose override to add restart policy to services and inject network parameters if provided
  $override = @("version: '3.8'","services:")
  $envLines = @()
  # Quote values to ensure YAML parses when URLs contain ':' or values look like numbers/hex
  if ($RpcHttpUrl) { $envLines += ('      RPC_HTTP_URL: "' + $RpcHttpUrl + '"') }
  if ($ChainId)    { $envLines += ('      CHAIN_ID: "' + $ChainId + '"') }
  if ($WorldAddress){ $envLines += ('      WORLD_ADDRESS: "' + $WorldAddress + '"') }
  if ($StartBlock) { $envLines += ('      START_BLOCK: "' + $StartBlock + '"') }
  if ($FollowBlockTag) { $envLines += ('      FOLLOW_BLOCK_TAG: "' + $FollowBlockTag + '"') }
  if ($PollingIntervalMs) { $envLines += ('      POLLING_INTERVAL: "' + $PollingIntervalMs + '"') }
  if ($MaxBlockRange) { $envLines += ('      MAX_BLOCK_RANGE: "' + $MaxBlockRange + '"') }

  $overridePath = Join-Path $RepoDir "docker-compose.override.local.yml"
  # Build YAML for restart policies always; include environment only when env lines provided
  $svcParts = @(
    "  postgres:",
    "    restart: unless-stopped",
    "  postgres-index-write:",
    "    restart: unless-stopped"
  )
  if ($envLines.Length -gt 0) {
    $svcParts += @("    environment:") + $envLines
  }
  $svcParts += @(
    '  postgres-query-read:',
    '    restart: unless-stopped',
    '    command: sh -lc "pnpm build; pnpm start"'
  )
  if ($envLines.Length -gt 0) {
    $svcParts += @("    environment:") + $envLines
  }
  $content = ($override -join "`n") + "`n" + ($svcParts -join "`n") + "`n"
  Set-Content -Path $overridePath -Value $content -Encoding UTF8
  Write-Host "[indexer] Wrote override -> $overridePath" -ForegroundColor Yellow
  Write-Host "[indexer] Building reader image..." -ForegroundColor Cyan
  if ($overridePath) {
    docker compose -f docker-compose.local.yml -f $overridePath build postgres-query-read
  } else {
    docker compose -f docker-compose.local.yml build postgres-query-read
  }
  Write-Host "[indexer] Bringing up services..." -ForegroundColor Cyan
  if ($overridePath) {
    docker compose -f docker-compose.local.yml -f $overridePath up -d
  } else {
    docker compose -f docker-compose.local.yml up -d
  }
  Write-Host "[indexer] Stack launched (detached)." -ForegroundColor Green
} finally {
  Pop-Location
}
