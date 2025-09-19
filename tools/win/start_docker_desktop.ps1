param(
  [int]$WaitSeconds = 0
)
$ErrorActionPreference = 'Stop'

$exe = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'
if (-not (Test-Path $exe)) {
  $alt = (Get-Command 'Docker Desktop.exe' -ErrorAction SilentlyContinue).Source
  if ($alt) { $exe = $alt }
}
if (-not (Test-Path $exe)) {
  Write-Error 'Docker Desktop executable not found. Please install Docker Desktop.'
  exit 1
}

Write-Host "[docker] Launching Docker Desktop: $exe"
Start-Process -FilePath $exe -WindowStyle Minimized | Out-Null

if ($WaitSeconds -gt 0) {
  Write-Host "[docker] Waiting $WaitSeconds seconds for UI bootstrap..."
  Start-Sleep -Seconds $WaitSeconds
}

Write-Host '[docker] Started (UI launched).'
