<#
  register_startup_tasks.ps1
  Creates two Scheduled Tasks:
   1) EF-Stack-Startup (SYSTEM, At startup) → runs start_local_stack.ps1
   2) EF-Stack-AtLogon (current user, At logon) → runs start_docker_and_stack_at_logon.ps1

  Notes:
  - Prefer PowerShell Register-ScheduledTask; on AccessDenied (0x80070005), fall back to schtasks.exe.
  - Tasks are placed under a custom folder "\\EF-Map\\" to avoid name collisions and clarify scope.
  - Run this script elevated (Administrator) for best results; the logon task may succeed without elevation.
#>
param()
$ErrorActionPreference = 'Stop'

# Self-elevate if not running as Administrator
function Test-IsAdmin {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($current)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
  Write-Host 'Elevation required. Relaunching this script as Administrator...'
  $self = $MyInvocation.MyCommand.Path
  Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$self`"") -Verb RunAs | Out-Null
  exit 0
}

$startupScript = Join-Path $PSScriptRoot 'start_local_stack.ps1'
$logonScript   = Join-Path $PSScriptRoot 'start_docker_and_stack_at_logon.ps1'

if (-not (Test-Path $startupScript)) { throw "Missing script: $startupScript" }
if (-not (Test-Path $logonScript))   { throw "Missing script: $logonScript" }

$taskFolder = '\EF-Map\'
$startupName = 'EF-Stack-Startup'
$logonName   = 'EF-Stack-AtLogon'
$startupTn   = "$taskFolder$startupName"
$logonTn     = "$taskFolder$logonName"
$created = @{}

function Register-OrFallback {
  param(
    [string]$tn,
    [scriptblock]$buildTask, # returns a ScheduledTask
    [string[]]$schtasksArgs  # argument list after /Create
  )
  try {
    $taskObj = & $buildTask
    # Extract the leaf name for PS cmdlet; provide -TaskPath to ensure folder
    $leaf = Split-Path -Path $tn -Leaf
    $path = Split-Path -Path $tn -Parent
    if (-not $path) { $path = '\\' }
    Register-ScheduledTask -TaskName $leaf -TaskPath $path -InputObject $taskObj -Force | Out-Null
    return @{ ok=$true; method='Register-ScheduledTask'; tn=$tn }
  } catch {
    $msg = $_.Exception.Message
    if ($msg -notmatch 'Access is denied|0x80070005') { throw }
    Write-Warning "Register-ScheduledTask denied for $tn; falling back to schtasks.exe (/Create /F)"
  $schtArgs = @('/Create','/F') + $schtasksArgs
  $p = Start-Process -FilePath 'schtasks.exe' -ArgumentList $schtArgs -NoNewWindow -PassThru -Wait
    if ($p.ExitCode -ne 0) { throw "schtasks.exe failed for $tn with exit code $($p.ExitCode)" }
    return @{ ok=$true; method='schtasks'; tn=$tn }
  }
}

# 1) SYSTEM at-startup task
$psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
# Arguments for PowerShell action (Register-ScheduledTask path)
$startupArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$startupScript`""
# Full command string for schtasks.exe (/TR expects full command line)
$startupTr = "$psExe $startupArgs"
$startupSchtasksArgs = @('/TN', $startupTn, '/SC','ONSTART','/RL','HIGHEST','/RU','SYSTEM','/TR', $startupTr)
$startupResult = Register-OrFallback -tn $startupTn -buildTask {
  $action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $startupArgs
  $trigger  = New-ScheduledTaskTrigger -AtStartup
  $principal= New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
} -schtasksArgs $startupSchtasksArgs
$created[$startupTn] = $startupResult.method

# 2) User at-logon task
$currentUser = "$env:USERDOMAIN\$env:USERNAME"
# Arguments for PowerShell action (Register-ScheduledTask path)
$logonArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$logonScript`""
# Full command string for schtasks.exe
$logonTr = "$psExe $logonArgs"
$logonSchtasksArgs = @('/TN', $logonTn, '/SC','ONLOGON','/RL','HIGHEST','/RU', $currentUser, '/TR', $logonTr, '/IT')
$logonResult = Register-OrFallback -tn $logonTn -buildTask {
  $action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $logonArgs
  $trigger  = New-ScheduledTaskTrigger -AtLogOn
  $principal= New-ScheduledTaskPrincipal -UserId $currentUser -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
  New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
} -schtasksArgs $logonSchtasksArgs
$created[$logonTn] = $logonResult.method

Write-Host ("Tasks created/updated:" + [Environment]::NewLine + ($created.GetEnumerator() | ForEach-Object { " - $($_.Key) via $($_.Value)" } | Out-String))
