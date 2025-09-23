$ErrorActionPreference = 'Stop'

# Defaults (override by setting env before running this script)
if (-not $env:RPC_URL)        { $env:RPC_URL        = 'https://rpc.pyropechain.com' }
if ($env:RPC_URL -eq 'True' -or $env:RPC_URL -eq 'true' -or ($env:RPC_URL -notmatch '^https?://')) { $env:RPC_URL = 'https://rpc.pyropechain.com' }
if (-not $env:CHAIN_ID)       { $env:CHAIN_ID       = '695569' }
if (-not $env:WORLD_ADDRESS)  { $env:WORLD_ADDRESS  = '0x7085f3e652987f656fB8dEE5aA6592197Bb75de8' }
if (-not $env:LOCAL_DB_PATH -or $env:LOCAL_DB_PATH -eq 'True' -or $env:LOCAL_DB_PATH -eq 'true')  { $env:LOCAL_DB_PATH  = 'c:\EF-Map-main\data\local-indexer.db' }
if (-not $env:STATUS_PATH   -or $env:STATUS_PATH   -eq 'True' -or $env:STATUS_PATH   -eq 'true')  { $env:STATUS_PATH    = 'c:\EF-Map-main\data\local-indexer-status.json' }
if (-not $env:HISTORY_PATH  -or $env:HISTORY_PATH  -eq 'True' -or $env:HISTORY_PATH  -eq 'true')  { $env:HISTORY_PATH   = 'c:\EF-Map-main\data\local-indexer-status-history.json' }
if (-not $env:CONTROL_PATH  -or $env:CONTROL_PATH  -eq 'True' -or $env:CONTROL_PATH  -eq 'true')  { $env:CONTROL_PATH   = 'c:\EF-Map-main\data\local-indexer-control.json' }
if (-not $env:PID_PATH      -or $env:PID_PATH      -eq 'True' -or $env:PID_PATH      -eq 'true')  { $env:PID_PATH       = 'c:\EF-Map-main\data\local-indexer-ingest.pid' }
if (-not $env:FROM_BLOCK)     { $env:FROM_BLOCK     = '7288348' }
if (-not $env:CONFIRM_DEPTH)  { $env:CONFIRM_DEPTH  = '6' }
if (-not $env:WINDOW_BLOCKS)  { $env:WINDOW_BLOCKS  = '20000' }
if (-not $env:SEGMENT_BLOCKS) { $env:SEGMENT_BLOCKS = '1200' }
if (-not $env:DB_ENGINE -or $env:DB_ENGINE -eq 'True' -or $env:DB_ENGINE -eq 'true') { $env:DB_ENGINE = 'better-sqlite3' }

# Ensure data & scratch dirs
New-Item -ItemType Directory -Force -Path 'c:\EF-Map-main\data' | Out-Null
New-Item -ItemType Directory -Force -Path 'c:\EF-Map-main\scratch' | Out-Null

# Clear stop flag and ensure not paused
$ctrlPath = $env:CONTROL_PATH
$ctrl = @{ paused = $false; stop = $false } | ConvertTo-Json -Compress
Set-Content -Path $ctrlPath -Value $ctrl -Encoding UTF8

# Launch ingestion detached with logs
$logOut = 'c:\EF-Map-main\scratch\ingest.out.log'
$logErr = 'c:\EF-Map-main\scratch\ingest.err.log'
$proc = Start-Process -FilePath node -ArgumentList 'c:\EF-Map-main\tools\local-indexer\ingest_raw.js' -RedirectStandardOutput $logOut -RedirectStandardError $logErr -WindowStyle Hidden -PassThru
Write-Output ("Ingestor started. PID=" + $proc.Id)
Write-Output ("Logs -> " + $logOut)
exit 0