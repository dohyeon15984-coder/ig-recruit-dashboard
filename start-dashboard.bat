@echo off
REM Starts the local dashboard server and opens the browser. Closing this window stops the server.
cd /d "%~dp0"
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
node server.js
pause
