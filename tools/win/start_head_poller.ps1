$ErrorActionPreference = 'Stop'

# Detect network
$netJson = docker inspect pg-indexer-reader-postgres-1 --format '{{json .NetworkSettings.Networks}}'
$netObj = $netJson | ConvertFrom-Json
$network = ($netObj.PSObject.Properties | Select-Object -First 1).Name
if (-not $network) { throw "Could not detect indexer Docker network" }

# Build image
docker build -t ef-head-poller "tools/head-poller" | Out-Null

# Remove previous
try { docker rm -f ef-head-poller | Out-Null } catch {}

# Run
docker run -d --name ef-head-poller `
  --network $network `
  -e RPC_HTTP_URL="https://rpc.pyropechain.com" `
  -e CHAIN_ID=695569 `
  -e PG_URL="postgres://user:password@postgres:5432/postgres" `
  -e INTERVAL_MS=15000 `
  --restart unless-stopped `
  ef-head-poller | Out-Null

Write-Host "Head poller started. Will write into schema meta.* every 15s."
