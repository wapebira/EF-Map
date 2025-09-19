$ErrorActionPreference = 'Stop'

function Test-VSBuildToolsInstalled {
  try {
    $vswhere = "$env:ProgramFiles(x86)\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
      $out = & $vswhere -latest -requires Microsoft.VisualStudio.Workload.VCTools -format json 2>$null
      if ($LASTEXITCODE -eq 0 -and $out) { return $true }
    }
  } catch {}
  return $false
}

if (Test-VSBuildToolsInstalled) {
  Write-Host "[vsbuildtools] Already installed" -ForegroundColor Green
  exit 0
}

$temp = Join-Path $env:TEMP "vs_BuildTools.exe"
$url = "https://aka.ms/vs/17/release/vs_BuildTools.exe"
Write-Host "[vsbuildtools] Downloading bootstrapper..." -ForegroundColor Cyan
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $temp

Write-Host "[vsbuildtools] Starting installer (you may see a UAC prompt)..." -ForegroundColor Cyan
$args = @(
  "--quiet",
  "--wait",
  "--norestart",
  "--nocache",
  "--add", "Microsoft.VisualStudio.Workload.VCTools",
  "--includeRecommended",
  "--includeOptional"
)

Start-Process -FilePath $temp -ArgumentList $args -Verb RunAs -Wait

if (Test-VSBuildToolsInstalled) {
  Write-Host "[vsbuildtools] Install complete" -ForegroundColor Green
  exit 0
}

Write-Host "[vsbuildtools] Install may have failed or requires reboot. Check Visual Studio Installer." -ForegroundColor Yellow
exit 1
