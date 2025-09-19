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

if (Test-VSBuildToolsInstalled) { Write-Host "[vsbuildtools] Already installed" -ForegroundColor Green; exit 0 }

# Require winget
try { winget --version | Out-Null } catch { Write-Host "[vsbuildtools] winget not found. Update App Installer from Microsoft Store." -ForegroundColor Red; exit 1 }

Write-Host "[vsbuildtools] Installing via winget (silent)..." -ForegroundColor Cyan
# Visual Studio 2022 Build Tools ID
$pkg = 'Microsoft.VisualStudio.2022.BuildTools'

# Include VC++ workload and recommended components
$args = @(
  'install', '--id', $pkg,
  '--silent', '--accept-package-agreements', '--accept-source-agreements',
  "--override", "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --includeOptional"
)

winget @args

if (Test-VSBuildToolsInstalled) { Write-Host "[vsbuildtools] Install complete" -ForegroundColor Green; exit 0 }
Write-Host "[vsbuildtools] Install may require a reboot or manual completion in Visual Studio Installer." -ForegroundColor Yellow
exit 1
