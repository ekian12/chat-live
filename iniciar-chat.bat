@echo off
cd /d "%~dp0"
start "Chat en vivo - Servidor" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
timeout /t 2 >nul
start "" http://localhost:3000
