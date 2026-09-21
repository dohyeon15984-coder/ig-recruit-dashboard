@echo off
REM Renews the Instagram access token and updates .env automatically.
cd /d "%~dp0"
echo.
echo Paste the new token from Meta Graph API Explorer (right-click pastes), then press Enter:
set /p TOKEN=
echo.
node scripts\refresh-token.js --save "%TOKEN%"
echo.
echo If it says success, close the dashboard server window and run start-dashboard.bat again.
pause
