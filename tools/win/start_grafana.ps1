$ErrorActionPreference = 'Stop'

# Discover compose network (parse JSON to avoid Go template escaping issues)
$networksJson = docker inspect pg-indexer-reader-postgres-1 --format '{{json .NetworkSettings.Networks}}'
if (-not $networksJson) { throw "Failed to query Docker for container networks." }
$networksObj = $networksJson | ConvertFrom-Json
$network = ($networksObj.PSObject.Properties | Select-Object -First 1).Name
if (-not $network) { throw "Could not detect indexer Docker network (is the stack running?)" }

# Ensure any previous container is removed
try { docker rm -f ef-grafana | Out-Null } catch {}

# Create local folders for provisioning and dashboards
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$prov = Join-Path $root 'grafana\provisioning'
$dash = Join-Path $root 'grafana\dashboards'
if (-not (Test-Path $prov)) { throw "Provisioning path not found: $prov" }
if (-not (Test-Path $dash)) { throw "Dashboards path not found: $dash" }

# Launch Grafana
docker run -d --name ef-grafana `
  --network $network `
  -p 3000:3000 `
  -v "${prov}:/etc/grafana/provisioning" `
  -v "${dash}:/var/lib/grafana/dashboards" `
  --restart unless-stopped `
  grafana/grafana:10.4.3 | Out-Null

Write-Host "Grafana started at http://localhost:3000 (user: admin, pass: admin)."
