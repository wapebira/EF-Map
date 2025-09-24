# Emits synthetic Smart Gates usage events to a Cloudflare Pages preview,
# optionally forces an in-worker usage flush, and fetches stats for verification.
# Usage examples:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/preview/emit_sg_events.ps1 -Host feature-sg-stats.ef-map.pages.dev -Hops 5 -Flush -HistoryDays 1 -Debug
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/preview/emit_sg_events.ps1 -BaseUrl https://feature-sg-stats.ef-map.pages.dev

[CmdletBinding()]
param(
  [string] $HostName = 'feature-sg-stats.ef-map.pages.dev',
  [string] $BaseUrl,
  [int] $Hops = 5,
  [switch] $Flush,
  [int] $HistoryDays = 1,
  [switch] $VerboseStats
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $BaseUrl) {
  if (-not $HostName) { throw "Provide -HostName or -BaseUrl" }
  $BaseUrl = "https://$HostName"
}

$usageUrl = "$BaseUrl/api/usage-event"
# On *.pages.dev, add openPreview=1 to bypass in-memory aggregation for deterministic tests
$isPreviewHost = $false
try {
  $uObj = [System.Uri]$BaseUrl
  $isPreviewHost = $uObj.Host -like '*.pages.dev'
} catch {
  if ($BaseUrl -match 'pages\.dev') { $isPreviewHost = $true }
}
if ($isPreviewHost) {
  if ($usageUrl -notmatch '\?') { $usageUrl += '?openPreview=1' } else { $usageUrl += '&openPreview=1' }
}
$flushUrl = "$BaseUrl/api/usage-flush?openPreview=1"
$statsUrl = "$BaseUrl/api/stats?history=$HistoryDays" + ($(if($VerboseStats){'&debug=1'}else{''}))

Write-Host "Posting sg_* events to $usageUrl ..." -ForegroundColor Cyan

$events = @(
  @{ type = 'sg_route_unrestricted'; body = @{} },
  @{ type = 'sg_route_authorized';   body = @{} },
  @{ type = 'sg_route_any';          body = @{} },
  @{ type = 'sg_hops';               body = @{ count = $Hops } }
)

$payload = @{ events = $events } | ConvertTo-Json -Depth 5

$resp = Invoke-WebRequest -UseBasicParsing -Uri $usageUrl -Method POST -ContentType 'application/json' -Body $payload
Write-Host "Usage POST status: $($resp.StatusCode)" -ForegroundColor Green

if ($Flush.IsPresent) {
  Write-Host "Forcing flush via $flushUrl ..." -ForegroundColor Cyan
  $flushResp = Invoke-RestMethod -UseBasicParsing -Uri $flushUrl -Method GET
  Write-Host ("Flush result: " + ($flushResp | ConvertTo-Json -Depth 6)) -ForegroundColor DarkGray
}

Write-Host "Fetching stats from $statsUrl ..." -ForegroundColor Cyan
$stats = Invoke-RestMethod -UseBasicParsing -Uri $statsUrl -Method GET

# Print a concise summary of the metrics we care about
function Get-CounterOrDefault($obj, $key){
  if (-not $obj) { return 0 }
  if ($obj -is [System.Collections.IDictionary]) { if ($obj.Contains($key)) { return [int]$obj[$key] } else { return 0 } }
  $prop = $obj.PSObject.Properties[$key]
  if ($prop) { return [int]$prop.Value } else { return 0 }
}
function Get-SumOrDefault($obj, $key){
  if (-not $obj) { return 0 }
  if ($obj -is [System.Collections.IDictionary]) { if ($obj.Contains($key)) { return [int]$obj[$key] } else { return 0 } }
  $prop = $obj.PSObject.Properties[$key]
  if ($prop) { return [int]$prop.Value } else { return 0 }
}

$cur = $stats.current
$c = $cur.counters
$s = $cur.sums

$summary = [ordered]@{
  sg_route_any           = (Get-CounterOrDefault $c 'sg_route_any')
  sg_route_unrestricted  = (Get-CounterOrDefault $c 'sg_route_unrestricted')
  sg_route_authorized    = (Get-CounterOrDefault $c 'sg_route_authorized')
  sg_hops_sum            = (Get-SumOrDefault $s 'sg_hops_sum')
  sg_hops_count          = (Get-SumOrDefault $s 'sg_hops_count')
  updatedAt              = $cur.updatedAt
}

Write-Host "Current counters/sums:" -ForegroundColor Yellow
$summary | ConvertTo-Json -Depth 4 | Write-Output

# If history is present, also print the most recent day's counters/sums
if ($stats.history -and $stats.history.Count -gt 0) {
  $latest = $stats.history[-1]
  $hc = $latest.counters
  $hs = $latest.sums
  $hSummary = [ordered]@{
    date                  = $latest.date
    sg_route_any          = (Get-CounterOrDefault $hc 'sg_route_any')
    sg_route_unrestricted = (Get-CounterOrDefault $hc 'sg_route_unrestricted')
    sg_route_authorized   = (Get-CounterOrDefault $hc 'sg_route_authorized')
    sg_hops_sum           = (Get-SumOrDefault $hs 'sg_hops_sum')
    sg_hops_count         = (Get-SumOrDefault $hs 'sg_hops_count')
  }
  Write-Host "Latest history counters/sums:" -ForegroundColor Yellow
  $hSummary | ConvertTo-Json -Depth 4 | Write-Output
}

if ($VerboseStats.IsPresent) {
  if ($stats.debug) {
    Write-Host "Debug info:" -ForegroundColor DarkYellow
    ($stats.debug | ConvertTo-Json -Depth 6) | Write-Output
  }
}

Write-Host "Done." -ForegroundColor Green
