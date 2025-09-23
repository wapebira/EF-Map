param(
  [switch]$Quiet
)
$ErrorActionPreference = 'Continue'

function Write-Info($msg) {
  if (-not $Quiet) { Write-Host $msg }
}

Write-Info '[wsl2] Enabling VirtualMachinePlatform...'
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
$vmpExit = $LASTEXITCODE

Write-Info '[wsl2] Enabling Microsoft-Windows-Subsystem-Linux...'
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
$wslExit = $LASTEXITCODE

Write-Info ("[wsl2] DISM exit codes -> VMP:{0} WSL:{1}" -f $vmpExit,$wslExit)

try {
  Write-Info '[wsl2] Setting WSL default version to 2 (may fail if kernel not present yet)...'
  wsl --set-default-version 2
} catch {
  Write-Info ('[wsl2] set-default-version note: ' + $_.Exception.Message)
}

Write-Info '[wsl2] Feature enable completed. If either exit code is 3010, a reboot is required.'
Write-Output (("{0}{1}{2}{3}{4}{5}{6}{7}{8}{9}{10}" -f '{', '"vmpExit"', ':', $vmpExit, ',', '"wslExit"', ':', $wslExit, '','', '}'))
