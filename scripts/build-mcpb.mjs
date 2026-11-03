#!/usr/bin/env node
/**
 * Construye la extensión de Claude Desktop (.mcpb) para spij-mcp.
 *
 *   node scripts/build-mcpb.mjs
 *
 * Genera dist/spij-mcp-<version>.mcpb con las dependencias de producción
 * empaquetadas y sin las carpetas de desarrollo. Funciona en Windows, macOS
 * y Linux (se usa así en GitHub Actions).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = path.resolve(raiz, "..", ".spij-mcp-build");
const dist = path.join(raiz, "dist");

function paso(texto) {
  console.log(`\n[build-mcpb] ${texto}`);
}

function copiar(desde, hasta) {
  fs.copyFileSync(desde, hasta);
}

paso("Preparando carpeta temporal");
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, "src"), { recursive: true });
fs.mkdirSync(dist, { recursive: true });

for (const archivo of ["manifest.json", "icon.png", "package.json", "package-lock.json", ".mcpbignore"]) {
  copiar(path.join(raiz, archivo), path.join(stage, archivo));
}

for (const archivo of fs.readdirSync(path.join(raiz, "src"))) {
  if (archivo.endsWith(".js")) {
    copiar(path.join(raiz, "src", archivo), path.join(stage, "src", archivo));
  }
}

paso("Instalando dependencias de producción");
const argsNpm = ["ci", "--omit=dev", "--cache", path.join(raiz, ".npm-cache"), "--no-audit", "--no-fund"];
if (process.env.npm_execpath) {
  execFileSync(process.execPath, [process.env.npm_execpath, ...argsNpm], {
    cwd: stage,
    stdio: "inherit",
  });
} else if (process.platform === "win32") {
  execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm", ...argsNpm], {
    cwd: stage,
    stdio: "inherit",
  });
} else {
  execFileSync("npm", argsNpm, {
    cwd: stage,
    stdio: "inherit",
  });
}

const paquete = JSON.parse(fs.readFileSync(path.join(raiz, "package.json"), "utf8"));
const salida = path.join(dist, `spij-mcp-${paquete.version}.mcpb`);

paso(`Empaquetando ${salida}`);
const cli = path.join(raiz, "node_modules", "@anthropic-ai", "mcpb", "dist", "cli", "cli.js");
execFileSync(process.execPath, [cli, "pack", stage, salida], { stdio: "inherit" });

fs.rmSync(stage, { recursive: true, force: true });
paso(`Listo: ${salida}`);
