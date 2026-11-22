@echo off
chcp 65001 >nul
title SPIJ MCP
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se encontro Node.js instalado en esta computadora.
  echo  Descargalo gratis desde: https://nodejs.org/
  echo  O usa el instalador SPIJ-MCP-Setup.exe (no requiere Node.js):
  echo  https://github.com/dariodemh/spijmcp/releases/latest
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo  Instalando dependencias la primera vez...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo  Error al instalar dependencias. Revisa tu conexion a internet.
    pause
    exit /b 1
  )
)

node src/server.js --ui
if errorlevel 1 (
  echo.
  echo  SPIJ MCP se detuvo con un error.
  pause
)
