@echo off
REM Starts the local dashboard server and opens the browser. Closing this window stops the server.
cd /d "%~dp0"
REM If a server is already running on port 3000, just open the browser instead of starting a second one.
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul
if not errorlevel 1 (
  echo Dashboard is already running. Opening the browser...
  start "" http://localhost:3000
  timeout /t 3 /nobreak >nul
  exit /b
)
start "" cmd /c "timeout /t 3 /nobreak >/dev/null & start http://localhost:3000"
node server.js
pause
