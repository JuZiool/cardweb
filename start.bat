@echo off
REM 独立启动 cardweb（脱离当前终端/IDE 的进程树）
REM 关闭这个窗口不影响服务；要停服务用 stop.bat
cd /d "%~dp0"

set PORT=8052
set POLL_MINUTES=0

echo Starting cardweb on http://127.0.0.1:%PORT%
start "cardweb" /min cmd /c "node server.js > data\server.log 2>&1"

timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/api/health' -UseBasicParsing -TimeoutSec 5; Write-Host ('OK  ' + $r.StatusCode) } catch { Write-Host ('FAIL ' + $_.Exception.Message) }"
