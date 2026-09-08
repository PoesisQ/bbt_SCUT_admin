@echo off
powershell.exe -NoProfile -File "%~dp0start-assistant.ps1"
if errorlevel 1 pause
