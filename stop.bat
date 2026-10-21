@echo off
REM 停止占用 8052 端口的 cardweb 进程
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8052" ^| findstr "LISTENING"') do (
  echo Killing PID %%p
  taskkill /PID %%p /F >nul 2>&1
)
echo Stopped.
