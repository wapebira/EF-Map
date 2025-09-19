param(
  [int]$IntervalSec = 900,
  [switch]$Minimized,
  [switch]$Once
)

$loop = Join-Path $PSScriptRoot 'run_worldapi_dlt_loop.ps1'
if (-not (Test-Path $loop)) { throw "Loop script not found: $loop" }

$pwsh = (Get-Command powershell).Source
$title = "WorldAPI dlt loop (" + $IntervalSec + "s)"

# Build argument list to set window title, run the loop, and keep the window open on exit/errors
$onceArg = if ($Once) { ' -Once' } else { '' }
$inner = "$host.UI.RawUI.WindowTitle='$title'; & '$loop' -IntervalSec $IntervalSec$onceArg; Write-Host ''; Write-Host 'Loop exited. Press Ctrl+C or close window.'"
$args = @('-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-Command', $inner)

$ws = if ($Minimized) { 'Minimized' } else { 'Normal' }
Start-Process -FilePath $pwsh -ArgumentList $args -WindowStyle $ws | Out-Null
Write-Host "Launched: $title"
