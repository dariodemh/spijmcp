# Construye la extensión de Claude Desktop (.mcpb) para spij-mcp.
#
#   powershell -ExecutionPolicy Bypass -File scripts\build-mcpb.ps1
#
# Es un envoltorio de scripts/build-mcpb.mjs, que funciona en cualquier sistema.

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

& node (Join-Path $root "scripts\build-mcpb.mjs")
exit $LASTEXITCODE
