@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  start "FKiS SQLite server" /min py -3 server.py
) else (
  where python >nul 2>nul
  if %errorlevel% neq 0 (
    echo Python 3 ne naiden. Ustanovite Python 3 i zapustite fail snova.
    pause
    exit /b 1
  )
  start "FKiS SQLite server" /min python server.py
)

timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:4174/
endlocal
