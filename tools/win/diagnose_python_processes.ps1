# EF-Map – Diagnose Python Process Relaunch Sources
# Purpose: Robustly enumerate python.exe processes, their parents and command lines,
# and scan common auto-start vectors: Scheduled Tasks, Startup folders, Services, and Run keys.
# Outputs concise tables to console and writes JSON snapshots under repo root for later review.

param(
    [switch]$KillWorldApi
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

Write-Host "== Processes: python.exe (with PPID, parent name, path, command line) ==" -ForegroundColor Cyan
try {
    $procs = Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue
} catch {
    $procs = @()
}

$procRows = @()
foreach ($p in ($procs | Sort-Object ProcessId)) {
    try {
        $pp = $null
        if ($p.ParentProcessId -gt 0) {
            try { $pp = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue } catch {}
        }
        $psp = $null
        try { $psp = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue } catch {}
        $procRows += [pscustomobject]@{
            PID         = $p.ProcessId
            PPID        = $p.ParentProcessId
            ParentName  = if ($pp) { $pp.Name } else { $null }
            Name        = $p.Name
            Path        = if ($psp) { $psp.Path } else { $null }
            CreationDate= $p.CreationDate
            CommandLine = $p.CommandLine
        }
    } catch {}
}

if ($procRows.Count -gt 0) {
    $procRows | Format-Table -AutoSize
} else {
    Write-Host "No python.exe processes found." -ForegroundColor Yellow
}

# Write JSON snapshot
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$out1 = Join-Path $root 'tmp_python_processes.json'
$procRows | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $out1
Write-Host "Wrote $out1" -ForegroundColor DarkGray

if ($KillWorldApi -and $procRows.Count -gt 0) {
    Write-Host "`n== Kill mode: stopping world_api_dlt-related python.exe ==" -ForegroundColor Magenta
    $targets = $procRows | Where-Object { $_.CommandLine -match 'tools\\world_api_dlt\\pipeline\.py' -or $_.CommandLine -match 'run_world_api_dlt' }
    if ($targets -and ($targets | Measure-Object).Count -gt 0) {
        $pids = $targets | Select-Object -ExpandProperty PID
        Write-Host ("Stopping PIDs: {0}" -f ($pids -join ', ')) -ForegroundColor Yellow
        foreach ($pidToStop in $pids) {
            try { Stop-Process -Id $pidToStop -Force -ErrorAction SilentlyContinue } catch {}
        }
    } else {
        Write-Host "No matching world_api_dlt python.exe processes found." -ForegroundColor Yellow
    }
}

Write-Host "`n== Scheduled Tasks referencing python/powershell or repo scripts ==" -ForegroundColor Cyan
$taskRows = @()
try {
    $tasks = Get-ScheduledTask -ErrorAction SilentlyContinue
    foreach ($t in $tasks) {
        foreach ($a in ($t.Actions | ForEach-Object { $_ })) {
            $taskRows += [pscustomobject]@{
                TaskName  = $t.TaskName
                TaskPath  = $t.TaskPath
                Execute   = $a.Execute
                Arguments = $a.Arguments
            }
        }
    }
} catch {}

$taskHits = $taskRows | Where-Object {
    ($_.Execute -match 'python|powershell|pwsh') -or
    ($_.Arguments -match 'EF-Map-main|world_api|pipeline\.py|run_world_api')
}

if ($taskHits.Count -gt 0) {
    $taskHits | Sort-Object TaskPath,TaskName | Format-Table -AutoSize
} else {
    Write-Host "No matching scheduled tasks found." -ForegroundColor Yellow
}

$out2 = Join-Path $root 'tmp_tasks_scan.json'
$taskHits | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $out2
Write-Host "Wrote $out2" -ForegroundColor DarkGray

Write-Host "`n== Startup folders (user/all users) ==" -ForegroundColor Cyan
try {
    $userStartup = [Environment]::GetFolderPath('Startup')
} catch { $userStartup = $null }
$allStartup = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Startup'

$startup = @()
try {
    if ($userStartup) { $startup += Get-ChildItem -Force -ErrorAction SilentlyContinue $userStartup }
    $startup += Get-ChildItem -Force -ErrorAction SilentlyContinue $allStartup
} catch {}

$startupOut = $startup | Sort-Object FullName | Select-Object FullName, LastWriteTime, Length
if ($startupOut.Count -gt 0) {
    $startupOut | Format-Table -AutoSize
} else {
    Write-Host "Startup folders empty or not found." -ForegroundColor Yellow
}

$out3 = Join-Path $root 'tmp_startup_scan.json'
$startupOut | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $out3
Write-Host "Wrote $out3" -ForegroundColor DarkGray

Write-Host "`n== Services referencing python.exe or repo scripts ==" -ForegroundColor Cyan
$svcHits = @()
try {
    $svcs = Get-WmiObject Win32_Service -ErrorAction SilentlyContinue
    $svcHits = $svcs | Where-Object { $_.PathName -match 'python\.exe' -or $_.PathName -match 'EF-Map-main|world_api|pipeline\.py' } |
        Select-Object Name, State, StartMode, PathName
} catch {}

if ($svcHits -and ($svcHits | Measure-Object).Count -gt 0) {
    $svcHits | Format-Table -AutoSize
} else {
    Write-Host "No matching services found." -ForegroundColor Yellow
}

$out4 = Join-Path $root 'tmp_services_scan.json'
$svcHits | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $out4
Write-Host "Wrote $out4" -ForegroundColor DarkGray

Write-Host "`n== Registry Run keys (HKCU/HKLM, 32/64-bit) matching python/repo ==" -ForegroundColor Cyan
$runPaths = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'
)
$runHits = @()
foreach ($rk in $runPaths) {
    try {
        $item = Get-ItemProperty -Path $rk -ErrorAction SilentlyContinue
        if ($item) {
            $item.PSObject.Properties | Where-Object { $_.Name -ne 'PSPath' -and $_.Name -ne 'PSParentPath' -and $_.Name -ne 'PSChildName' -and $_.Name -ne 'PSDrive' -and $_.Name -ne 'PSProvider' } |
                ForEach-Object {
                    $name = $_.Name; $val = [string]$_.Value
                    if ($val -match 'python|EF-Map-main|world_api|pipeline\.py') {
                        $runHits += [pscustomobject]@{ Key=$rk; Name=$name; Value=$val }
                    }
                }
        }
    } catch {}
}

if ($runHits.Count -gt 0) {
    $runHits | Format-Table -AutoSize
} else {
    Write-Host "No matching Run key entries found." -ForegroundColor Yellow
}

$out5 = Join-Path $root 'tmp_runkeys_scan.json'
$runHits | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $out5
Write-Host "Wrote $out5" -ForegroundColor DarkGray

Write-Host "`nDiagnostics complete." -ForegroundColor Green
