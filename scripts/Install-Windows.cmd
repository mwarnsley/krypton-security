@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Krypton native setup is unavailable on Windows. No client settings were changed.
  echo Windows supports the dashboard demonstration only; Node is also missing from PATH.
  exit /b 1
)
node "%~dp0..\src\cli\setup.cjs" %*
exit /b %errorlevel%
