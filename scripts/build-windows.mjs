#!/usr/bin/env node
/**
 * Construye el paquete nativo de Windows y (si Inno Setup está disponible)
 * el instalador `dist/SPIJ-MCP-Setup.exe`.
 *
 *   node scripts/build-windows.mjs
 *
 * Requisitos en Windows:
 *   - .NET Framework 4.x (`csc.exe`, incluido en Windows 10/11)
 *   - Inno Setup 6 (`ISCC.exe`, preinstalado en GitHub Actions `windows-latest`)
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.error("[build-win] Este script solo se ejecuta en Windows.");
  process.exit(1);
}

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(raiz, "dist");
const stage = path.join(dist, "win-stage");
const appDir = path.join(stage, "app");
const runtimeDir = path.join(stage, "runtime");

const paquete = JSON.parse(fs.readFileSync(path.join(raiz, "package.json"), "utf8"));

function paso(texto) {
  console.log(`\n[build-win] ${texto}`);
}

function buscarCsc() {
  const candidatos = [
    "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
    "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
  ];
  return candidatos.find((p) => fs.existsSync(p)) || null;
}

function buscarIscc() {
  const candidatos = [
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Inno Setup 6\\ISCC.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Inno Setup 6\\ISCC.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs\\Inno Setup 6\\ISCC.exe"),
  ];
  return candidatos.find((p) => p && fs.existsSync(p)) || null;
}

const csc = buscarCsc();
if (!csc) {
  console.error("[build-win] No se encontró csc.exe (.NET Framework 4.x).");
  process.exit(1);
}

paso("Preparando carpeta de empaquetado");
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(appDir, "src"), { recursive: true });
fs.mkdirSync(runtimeDir, { recursive: true });

for (const archivo of ["package.json", "package-lock.json", "icon.png"]) {
  fs.copyFileSync(path.join(raiz, archivo), path.join(appDir, archivo));
}

for (const archivo of fs.readdirSync(path.join(raiz, "src"))) {
  if (archivo.endsWith(".js")) {
    fs.copyFileSync(path.join(raiz, "src", archivo), path.join(appDir, "src", archivo));
  }
}

paso("Instalando dependencias de producción");
const argsNpm = ["ci", "--omit=dev", "--cache", path.join(raiz, ".npm-cache"), "--no-audit", "--no-fund"];
execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm", ...argsNpm], {
  cwd: appDir,
  stdio: "inherit",
});

paso(`Empaquetando runtime de Node.js (${process.version})`);
fs.copyFileSync(process.execPath, path.join(runtimeDir, "node.exe"));

paso("Compilando lanzador nativo SPIJ-MCP.exe");
const launcherCs = path.join(raiz, "installer", "launcher.cs");
const iconIco = path.join(raiz, "installer", "icon.ico");
const exeSalida = path.join(stage, "SPIJ-MCP.exe");

execFileSync(
  csc,
  [
    "/nologo",
    "/target:winexe",
    "/optimize+",
    `/win32icon:${iconIco}`,
    `/out:${exeSalida}`,
    "/reference:System.dll",
    "/reference:System.Drawing.dll",
    "/reference:System.Windows.Forms.dll",
    launcherCs,
  ],
  { stdio: "inherit" },
);

const iscc = buscarIscc();
if (!iscc) {
  paso(`Listo (carpeta portable en ${stage}). Instala Inno Setup 6 para generar SPIJ-MCP-Setup.exe.`);
  process.exit(0);
}

paso("Compilando instalador SPIJ-MCP-Setup.exe con Inno Setup");
const issPath = path.join(raiz, "installer", "spij-mcp.iss");
execFileSync(
  iscc,
  [
    `/DAppVersion=${paquete.version}`,
    `/DStageDir=${stage}`,
    `/DOutputDir=${dist}`,
    issPath,
  ],
  { stdio: "inherit" },
);

paso(`Instalador listo: ${path.join(dist, "SPIJ-MCP-Setup.exe")}`);
