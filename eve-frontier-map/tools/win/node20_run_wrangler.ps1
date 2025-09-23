param()

$ErrorActionPreference = 'Stop'

function Ensure-NodePortable {
  $tmpRoot = Join-Path $env:TEMP 'node_portable'
  if (-not (Test-Path $tmpRoot)) { New-Item -ItemType Directory -Path $tmpRoot | Out-Null }
  $zip = Join-Path $tmpRoot 'node.zip'
  $candidates = @(
    @{ ver = 'v22.11.0'; dir = 'node-v22.11.0-win-x64' },
    @{ ver = 'v22.10.0'; dir = 'node-v22.10.0-win-x64' },
    @{ ver = 'v22.9.0'; dir = 'node-v22.9.0-win-x64' },
    @{ ver = 'v20.18.1'; dir = 'node-v20.18.1-win-x64' }
  )
  $extractDir = $null
  foreach($c in $candidates){
    $tryDir = Join-Path $tmpRoot $c.dir
    if ($tryDir -and (Test-Path $tryDir)) { $extractDir = $tryDir; break }
  }
  if (-not $extractDir -or -not (Test-Path $extractDir)) {
    foreach($c in $candidates){
      try {
        $url = "https://nodejs.org/dist/$($c.ver)/$($c.dir).zip"
        Write-Host "[node] Downloading $($c.ver)..." -ForegroundColor Cyan
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
        Write-Host "[node] Extracting..." -ForegroundColor Cyan
        Expand-Archive -Path $zip -DestinationPath $tmpRoot -Force
        $extractDir = Join-Path $tmpRoot $c.dir
        if ($extractDir -and (Test-Path $extractDir)) { break }
      } catch { continue }
    }
  }
  if (-not $extractDir) { throw 'Failed to locate Node directory.' }
  $nodeExe = Join-Path $extractDir 'node.exe'
  # npm-cli.js location (Node Windows zip embeds npm under node_modules\npm\bin)
  $npmCli = Join-Path $extractDir 'node_modules/npm/bin/npm-cli.js'
  if (-not (Test-Path $npmCli)) {
    # Fallback: some dists may place npm under "lib"; attempt alternative
    $altNpm = Join-Path $extractDir 'lib/node_modules/npm/bin/npm-cli.js'
    if (Test-Path $altNpm) { $npmCli = $altNpm } else { throw 'Failed to locate npm-cli.js inside Node distribution.' }
  }
  return @{ NodeExe = $nodeExe; NpmCli = $npmCli }
}

function Ensure-LocalWrangler([string]$NodeExe, [string]$NpmCli, [string]$WorkDir){
  if (-not (Test-Path $WorkDir)) { New-Item -ItemType Directory -Path $WorkDir | Out-Null }
  $pkgJson = Join-Path $WorkDir 'package.json'
  # Ensure a valid package.json (avoid partial/empty file issues)
  if (-not (Test-Path $pkgJson)){
    Set-Content -LiteralPath $pkgJson -Value '{"name":"wrangler-local","version":"1.0.0","private":true}' -Encoding ASCII
  } else {
    try {
      $text = Get-Content -LiteralPath $pkgJson -Raw -ErrorAction Stop
      if (-not $text -or $text.Trim().Length -lt 2) {
        Set-Content -LiteralPath $pkgJson -Value '{"name":"wrangler-local","version":"1.0.0","private":true}' -Encoding ASCII
      } else {
        # Validate JSON
        $null = $text | ConvertFrom-Json -ErrorAction Stop
      }
    } catch {
      Set-Content -LiteralPath $pkgJson -Value '{"name":"wrangler-local","version":"1.0.0","private":true}' -Encoding ASCII
    }
  }
  Push-Location $WorkDir
  & $NodeExe $NpmCli install wrangler@^4.38.0 --no-audit --no-fund | Out-Null
  Pop-Location
  $wranglerJs = Join-Path $WorkDir 'node_modules/wrangler/bin/wrangler.js'
  if (-not (Test-Path $wranglerJs)) { throw 'Failed to install wrangler locally.' }
  return $wranglerJs
}

try {
  $bin = Ensure-NodePortable
  Write-Host "[node] Using: $($bin.NodeExe)" -ForegroundColor Green
  $work = Join-Path $env:TEMP 'wrangler-local'
  $wranglerJs = Ensure-LocalWrangler -NodeExe $bin.NodeExe -NpmCli $bin.NpmCli -WorkDir $work
  & $bin.NodeExe $wranglerJs @args
  exit $LASTEXITCODE
} catch {
  Write-Error $_
  exit 1
}
