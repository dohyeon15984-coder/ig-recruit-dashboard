@echo off
REM Renews the Instagram access token and updates .env automatically.
REM Reads the token from the clipboard (no need to paste into this window).
cd /d "%~dp0"
echo.
echo 1) Copy the new token in Graph API Explorer (Ctrl+C) 2) Then press any key here.
pause >nul
set "TOKEN="
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "(Get-Clipboard -Raw).Trim()"`) do set "TOKEN=%%T"
if "%TOKEN%"=="" (
  echo Clipboard is empty. Copy the token first, then run this again.
  pause
  exit /b
)
echo.
echo Token read from clipboard (length: checking)...
node scripts\refresh-token.js --save "%TOKEN%"
echo.
echo If it says success, close the dashboard server window and run start-dashboard.bat again.
pause
