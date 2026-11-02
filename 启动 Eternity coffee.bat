@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
cd /d "%~dp0app"

if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron binary not found.
  echo In this folder run:
  echo   node node_modules\electron\install.js
  pause
  exit /b 1
)

start "" "node_modules\electron\dist\electron.exe" .
endlocal
exit /b 0
