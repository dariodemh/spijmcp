@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [spij-mcp] No se encontro Node.js. Instalalo desde https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [spij-mcp] Instalando dependencias por primera vez...
  call npm install
  if errorlevel 1 (
    echo [spij-mcp] Error al instalar dependencias.
    pause
    exit /b 1
  )
)

node src/server.js --tunnel
if errorlevel 1 (
  echo.
  echo [spij-mcp] El servidor se detuvo con un error.
  pause
)
