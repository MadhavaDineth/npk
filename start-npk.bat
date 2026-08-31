@echo off
REM ============================================================
REM  NPK full-stack launcher
REM  Starts MySQL 9.1, the Django API, and the Vite web frontend,
REM  each in its OWN window so they keep running independently.
REM  Close a service's window to stop just that service.
REM ============================================================

set "MYSQLD=C:\wamp64\bin\mysql\mysql9.1.0\bin\mysqld.exe"
set "MYINI=C:\wamp64\bin\mysql\mysql9.1.0\my.ini"
set "PROJ=C:\wamp64\www\npk"
set "PY=C:\python\python.exe"

echo Starting MySQL 9.1 (port 3306)...
start "NPK - MySQL 9.1" cmd /k ""%MYSQLD%" --defaults-file="%MYINI%" --console"

echo Waiting for MySQL to come up...
timeout /t 6 /nobreak >nul

echo Starting Django API (0.0.0.0:8000)...
start "NPK - Django API" cmd /k "cd /d "%PROJ%" && set "PYTHONUTF8=1" && "%PY%" manage.py runserver 0.0.0.0:8000 --noreload"

echo Starting web frontend (Vite, port 5173)...
start "NPK - Web (Vite)" cmd /k "cd /d "%PROJ%\frontend" && npm run dev"

echo.
echo ============================================================
echo  All three launched in separate windows:
echo    Web dashboard : http://localhost:5173
echo    API (this PC) : http://127.0.0.1:8000
echo    API (phone)   : http://%COMPUTERNAME%:8000  (use your Wi-Fi IPv4 - run: ipconfig)
echo.
echo  If a window shows "address already in use", that service is
echo  already running - safe to close that one window.
echo ============================================================
echo.
pause
