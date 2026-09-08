$ErrorActionPreference='Stop'
$scutPidFile=Join-Path $PSScriptRoot '.local\server.pid'
if (-not (Test-Path -LiteralPath $scutPidFile)) { Write-Host '未找到本项目启动的服务进程。'; exit }
$scutPid=[int](Get-Content -LiteralPath $scutPidFile -Raw)
$scutProcess=Get-CimInstance Win32_Process -Filter "ProcessId = $scutPid"
$scutExpected=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '.venv\Scripts\python.exe'))
if ($scutProcess -and $scutProcess.ExecutablePath -eq $scutExpected -and $scutProcess.CommandLine -match 'assistant_service') {
    Stop-Process -Id $scutPid
    Wait-Process -Id $scutPid -Timeout 10 -ErrorAction SilentlyContinue
    Write-Host '本地服务已停止。未完成任务和已接收音频已保存，下次启动后可重试。'
} elseif ($scutProcess) { throw 'PID 已被其他进程使用，未停止任何程序。' }
