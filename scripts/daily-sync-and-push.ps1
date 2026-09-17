# Daily automation: 1) start local server briefly if not running, try /api/sync
# 2) push whatever local data exists to the deployed Render site.
# Registered in Windows Task Scheduler (task name: IG_Dashboard_DailySync).

$ErrorActionPreference = 'Continue'
$projectDir = "C:\Users\donga\OneDrive\Desktop\클로드코드\ig-recruit-dashboard"
$remoteUrl = "https://ig-recruit-dashboard.onrender.com"
$logFile = Join-Path $projectDir "scripts\daily-sync-log.txt"

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -Path $logFile -Value $line
}

Set-Location $projectDir
Log "=== daily sync started ==="

$portInUse = $null
try {
    $portInUse = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
} catch {}

$startedServer = $false
$serverProcess = $null
if (-not $portInUse) {
    Log "local server not running, starting it"
    $serverProcess = Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $projectDir -WindowStyle Hidden -PassThru
    $startedServer = $true
    Start-Sleep -Seconds 6
} else {
    Log "local server already running"
}

try {
    Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/sync" -TimeoutSec 90 | Out-Null
    Log "sync succeeded"
} catch {
    Log "sync failed (continuing anyway): $($_.Exception.Message)"
}

try {
    $pushOutput = node scripts\push-to-remote.js $remoteUrl 2>&1 | Out-String
    Log "push-remote output: $pushOutput"
} catch {
    Log "push-remote failed: $($_.Exception.Message)"
}

if ($startedServer -and $serverProcess) {
    Start-Sleep -Seconds 1
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    Log "stopped the local server we started"
}

Log "=== daily sync finished ==="
