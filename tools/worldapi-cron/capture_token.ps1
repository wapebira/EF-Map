Param(
    [Parameter(Mandatory=$false)][string]$NamespaceId = "2af7298532dd4acfbda8bf06020981ba"
)
$ErrorActionPreference = 'Stop'
$envFile = Join-Path -Path $PSScriptRoot -ChildPath '.env'

if (-not (Test-Path $PSScriptRoot)) { New-Item -ItemType Directory -Path $PSScriptRoot | Out-Null }
if (Test-Path $envFile) {
    $stamp = Get-Date -Format 'yyyyMMddHHmmss'
    Copy-Item $envFile "$envFile.bak_$stamp"
}

function Format-TokenMask([string]$t) {
    if ([string]::IsNullOrWhiteSpace($t)) { return 'empty' }
    if ($t.Length -lt 8) { return ("len=" + $t.Length) }
    return ($t.Substring(0,4) + '…' + $t.Substring($t.Length-4))
}

function Read-TokenHidden {
    Write-Host "Paste CLOUDFLARE_API_TOKEN (hidden):"
    $sec = Read-Host -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { $t = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    if ($null -eq $t) { return '' }
    return $t.Trim()
}

function Read-TokenClipboard {
    try {
        $clip = Get-Clipboard -Raw
        if ($null -ne $clip) {
            $lines = ($clip -split "\r?\n") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
            if ($lines.Count -gt 0) { return $lines[0].Trim() }
        }
    } catch {
        Write-Warning ("Clipboard read failed: " + $_.Exception.Message)
    }
    return ''
}

function Read-TokenVisible {
    $t = Read-Host "Paste CLOUDFLARE_API_TOKEN (visible)"
    if ($null -eq $t) { return '' }
    return $t.Trim()
}

function Get-Token {
    for ($attempt=1; $attempt -le 5; $attempt++) {
        Write-Host "Choose input method: [1] Hidden  [2] Clipboard  [3] Visible"
        $choice = Read-Host "Enter 1/2/3"
        switch ($choice) {
            '1' { $tok = Read-TokenHidden }
            '2' { $tok = Read-TokenClipboard }
            '3' { $tok = Read-TokenVisible }
            Default { $tok = '' }
        }
        if ([string]::IsNullOrWhiteSpace($tok)) { Write-Warning "Empty input. Try again."; continue }
        $len = $tok.Length
        Write-Host ("Captured len=" + $len + " masked=" + (Format-TokenMask $tok))
        if ($len -lt 30) { Write-Warning "Token looks too short. Try again."; continue }
        $yn = Read-Host "Use this token? [Y/N]"
        if ($yn -match '^(?i)y') { return $tok }
    }
    throw "Failed to capture a valid token after multiple attempts."
}

$token = Get-Token

# Optional CF_ACCOUNT_ID
$acct = Read-Host "Optionally paste CF_ACCOUNT_ID (32-char hex) or press Enter to skip"
if ($null -ne $acct) { $acct = $acct.Trim() } else { $acct = '' }

$lines = @()
$lines += ("EF_SNAPSHOTS_NAMESPACE_ID=" + $NamespaceId)
$lines += ("CF_API_TOKEN=" + $token)
$lines += ("CF_ACCOUNT_ID=" + $acct)
$lines += "FORCE_REMOTE=1"
$lines += "SNAPSHOT_DRY_RUN=0"
$lines += "LOG_JSON=1"

Set-Content -Path $envFile -Value $lines -Encoding UTF8
Write-Host ("Secrets captured to " + $envFile + " (git-ignored).")
