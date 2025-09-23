Param(
  [switch]$Register,
  [switch]$Remove,
  [int]$EveryMinutes = 5
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$taskName = 'EF-WorldAPI-FastFetch'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$scriptPath = Join-Path $repoRoot 'tools\win\run_world_api_dlt_fast.ps1'

if($Remove){
  if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false | Out-Null
    Write-Output "Removed scheduled task: $taskName"
  } else {
    Write-Output "Scheduled task not found: $taskName"
  }
  exit 0
}

if($Register){
  if(-not (Test-Path $scriptPath)){ Write-Error "Missing script: $scriptPath" }
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes) -RepetitionDuration ([TimeSpan]::MaxValue)
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType InteractiveToken
  $task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -MultipleInstances IgnoreNew)
  Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
  Write-Output "Registered scheduled task '$taskName' to run every $EveryMinutes minute(s)."
  exit 0
}

Write-Output "Usage: schedule_world_api_dlt.ps1 -Register -EveryMinutes 5 | -Remove"
exit 1
param(
  [string]$TaskName = 'EF-WorldAPI-Fast',
  [int]$Minutes = 5,
  [string]$Base = 'https://world-api-stillness.live.tech.evefrontier.com'
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent -Path $MyInvocation.MyCommand.Path
$scriptPath = Join-Path $here 'run_world_api_dlt_fast.ps1'
if(-not (Test-Path $scriptPath)){
  Write-Error "Runner not found: $scriptPath"
}
if($Minutes -lt 1){ $Minutes = 1 }

# Create an on-demand scheduled task running as the current user
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -Base `"$Base`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $Minutes) -RepetitionDuration ([TimeSpan]::MaxValue)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Write-Host "Scheduled task '$TaskName' created to run every $Minutes minutes." -ForegroundColor Green
Param(
	[int]$Minutes = 2,
	[string]$Mode = 'fast'
)

$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$root = Resolve-Path (Join-Path $here '..\..')
$scriptPath = Join-Path $here 'run_world_api_dlt.ps1'

Write-Host "To schedule with Windows Task Scheduler, run (as Admin):" -ForegroundColor Cyan
Write-Host "schtasks /Create /TN EFMap_WorldAPI_$Mode /TR 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"$scriptPath\" -Mode $Mode' /SC MINUTE /MO $Minutes /F" -ForegroundColor Yellow

Write-Host "Or run in a loop (current session only):" -ForegroundColor Cyan
Write-Host "while ($true) { & '$scriptPath' -Mode $Mode; Start-Sleep -Seconds ($Minutes*60) }" -ForegroundColor Yellow

