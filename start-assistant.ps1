param([switch]$Foreground, [switch]$NoBrowser)
$scutLaunchMutex = [Threading.Mutex]::new($false, 'Local\SCUTClassroomAssistantLauncher')
$scutLaunchAcquired = $false
try {
    try { $scutLaunchAcquired = $scutLaunchMutex.WaitOne(30000) }
    catch [Threading.AbandonedMutexException] { $scutLaunchAcquired = $true }
    if (-not $scutLaunchAcquired) { throw 'Another launcher is still starting the service.' }
$ErrorActionPreference = 'Stop'
$scutRoot = $PSScriptRoot
Set-Location -LiteralPath $scutRoot
& (Join-Path $scutRoot 'register-launcher.ps1')
try {
    $scutHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/health' -TimeoutSec 2
} catch { $scutHealth = $null }
if ($scutHealth -and $scutHealth.app -ne 'scut-local-assistant') {
    throw 'Port 8765 is already used by another program.'
}
if (-not $scutHealth) {
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'uv is required. Install it from https://docs.astral.sh/uv/.' }
    & uv sync --extra asr --python 3.12 --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    $scutPython = Join-Path $scutRoot '.venv\Scripts\python.exe'
    $env:PYTHONIOENCODING = 'utf-8'
    if ($Foreground) { & $scutPython -m assistant_service; exit $LASTEXITCODE }
    New-Item -ItemType Directory -Force -Path (Join-Path $scutRoot '.local') | Out-Null
    $scutProcess = Start-Process -FilePath $scutPython -ArgumentList @('-m','assistant_service') -WorkingDirectory $scutRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $scutRoot '.local\server.log') -RedirectStandardError (Join-Path $scutRoot '.local\server-error.log')
    $scutProcess.Id | Set-Content -LiteralPath (Join-Path $scutRoot '.local\server.pid')
    for ($scutAttempt=0; $scutAttempt -lt 30; $scutAttempt++) {
        Start-Sleep -Milliseconds 500
        try { $scutHealth=Invoke-RestMethod -Uri 'http://127.0.0.1:8765/health' -TimeoutSec 1; break } catch {}
    }
    if (-not $scutHealth) { throw 'Service failed to start. See .local/server-error.log.' }
}
Write-Host 'SCUT Classroom Assistant started: http://127.0.0.1:8765'
Write-Host 'Edge extension directory:' (Join-Path $scutRoot 'extension')
Write-Host 'First-time connection token:' (Join-Path $scutRoot '.local\connection.txt')
if (-not $NoBrowser) {
    Start-Process 'http://127.0.0.1:8765/'
}
} finally {
    if ($scutLaunchAcquired) { $scutLaunchMutex.ReleaseMutex() }
    $scutLaunchMutex.Dispose()
}
