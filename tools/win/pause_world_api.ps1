Param(
  [switch]$WhatIf
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Info($msg){ Write-Host $msg -ForegroundColor Cyan }
function Write-Warn($msg){ Write-Host $msg -ForegroundColor Yellow }
function Write-Ok($msg){ Write-Host $msg -ForegroundColor Green }

Write-Info "Pausing World API ingestion: stopping Python runners and disabling scheduled task(s)"

# 1) Find Python processes related to World API runner and stop them
$procMatches = @()
try {
  $allProcs = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(python|py)(\.exe)?$' }
  foreach($p in $allProcs){
    $cmd = $p.CommandLine
    if([string]::IsNullOrWhiteSpace($cmd)){ continue }
    if($cmd -match 'EF-Map-main.*tools.*world_api_dlt' -or $cmd -match 'run_world_api_dlt' -or $cmd -match 'pipeline\.py'){
      $procMatches += [pscustomobject]@{
        Id = $p.ProcessId
        Name = $p.Name
        WS_MB = [math]::Round(($p.WorkingSetSize/1MB),1)
        CommandLine = $cmd
      }
    }
  }
} catch {
  Write-Warn ("Failed to enumerate processes: {0}" -f $_.Exception.Message)
}

if($procMatches.Count -gt 0){
  Write-Warn "Found World API-related Python processes (will stop):"
  $procMatches | Sort-Object WS_MB -Descending | Format-Table -AutoSize | Out-Host
  foreach($p in $procMatches){
    try {
      if($WhatIf){ Write-Warn ("Would stop PID {0} ({1})" -f $p.Id, $p.Name) }
      else { Stop-Process -Id $p.Id -Force -ErrorAction Stop }
    } catch {
      Write-Warn ("Failed to stop PID {0}: {1}" -f $p.Id, $_.Exception.Message)
    }
  }
} else {
  Write-Ok "No matching World API Python processes found."
}

# 2) Disable scheduled task(s)
$taskNames = @('EF-WorldAPI-FastFetch','EF-WorldAPI-Fast','EFMap_WorldAPI_fast','EFMap_WorldAPI_Fast')
$disabled = @()
foreach($name in $taskNames){
  $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if($t){
    try {
      if($WhatIf){ Write-Warn ("Would disable scheduled task: {0}" -f $name) }
      else { Disable-ScheduledTask -TaskName $name -ErrorAction Stop | Out-Null }
      $disabled += $name
      Write-Warn ("Disabled scheduled task: {0}" -f $name)
    } catch {
      Write-Warn ("Failed to disable {0}: {1}" -f $name, $_.Exception.Message)
    }
  }
}

if($disabled.Count -eq 0){
  # Wildcard fallback for any WorldAPI tasks
  $cands = Get-ScheduledTask -TaskName '*WorldAPI*' -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -notmatch '^\\$' }
  if($cands){
    foreach($c in $cands){
      try {
        if($WhatIf){ Write-Warn ("Would disable scheduled task: {0}" -f $c.TaskName) }
        else { Disable-ScheduledTask -TaskName $c.TaskName -ErrorAction Stop | Out-Null }
        Write-Warn ("Disabled scheduled task (wildcard): {0}" -f $c.TaskName)
      } catch {
        Write-Warn ("Failed to disable {0}: {1}" -f $c.TaskName, $_.Exception.Message)
      }
    }
  } else {
    Write-Ok 'No WorldAPI-related scheduled tasks found.'
  }
}

# 3) Verification summary
Write-Info "\nVerification: top python processes by memory (post-stop)"
Get-Process -Name python,py -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,@{n='WS_MB';e={[math]::Round($_.WS/1MB,1)}} | Sort-Object WS_MB -Descending | Select-Object -First 5 | Format-Table -AutoSize | Out-Host
Write-Info "Scheduled tasks matching '*WorldAPI*'"
Get-ScheduledTask -TaskName '*WorldAPI*' -ErrorAction SilentlyContinue | Select-Object TaskName,State | Format-Table -AutoSize | Out-Host

Write-Ok "Pause complete."
