@echo off
REM Stops the local dashboard server running in the background (port 3000).
REM Use this after code updates, then double-click the desktop dashboard shortcut again to restart with the new code.
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
  taskkill /PID %%p /F >nul 2>&1
  set FOUND=1
)
if defined FOUND (echo Dashboard server stopped.) else (echo Dashboard server was not running.)
timeout /t 3 /nobreak >nul
