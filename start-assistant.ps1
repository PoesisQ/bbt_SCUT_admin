param([switch]$Foreground, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$scutRoot = $PSScriptRoot
Set-Location -LiteralPath $scutRoot
try {
    $scutHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/health' -TimeoutSec 2
} catch { $scutHealth = $null }
if ($scutHealth -and $scutHealth.app -ne 'scut-local-assistant') {
    throw '端口 8765 已被其他程序占用，请检查后重试。'
}
if (-not $scutHealth) {
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw '需要 uv。请先从 https://docs.astral.sh/uv/ 安装。' }
    & uv sync --extra asr --python 3.12 --quiet
    if ($LASTEXITCODE -ne 0) { throw '依赖安装失败。' }
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
    if (-not $scutHealth) { throw '服务未能启动，请查看 .local/server-error.log。' }
}
Write-Host 'SCUT 课堂助手已启动：http://127.0.0.1:8765'
Write-Host 'Edge 加载扩展目录：' (Join-Path $scutRoot 'extension')
Write-Host '首次连接口令：' (Join-Path $scutRoot '.local\connection.txt')
if (-not $NoBrowser) {
    Start-Process 'http://127.0.0.1:8765/'
}
