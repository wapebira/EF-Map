param(
  [switch]$Remove,
  [int]$IntervalSec = 900,
  [string]$TaskName = "EF-WorldAPI-dlt-Loop"
)

$taskPath = "\EF-Map\$TaskName"
$scriptPath = "${PSScriptRoot}/run_worldapi_dlt_loop.ps1"
$pwsh = (Get-Command powershell).Source

if ($Remove) {
  schtasks /Delete /TN $taskPath /F | Out-Null
  Write-Host "Removed scheduled task $taskPath"
  return
}

if (-not (Test-Path $scriptPath)) { throw "Loop script not found: $scriptPath" }

# Build action: start PowerShell that runs the loop script detached
$action = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`" -IntervalSec $IntervalSec"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest -LogonType InteractiveToken

try {
  Register-ScheduledTask -TaskName $taskPath -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
  Write-Host "Registered scheduled task $taskPath (At logon, interval ${IntervalSec}s)"
}
catch {
  Write-Error $_
}
