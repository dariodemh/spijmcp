/**
 * Túnel HTTPS local automático (Cloudflare Quick Tunnel) para exponer el
 * servidor MCP local a ChatGPT Desktop/Web o Gemini Web sin configuración previa.
 *
 * - Si `cloudflared` ya está instalado en el sistema, lo usa directamente.
 * - Si no está instalado, descarga una sola vez el binario oficial de Cloudflare
 *   en `~/.spij-mcp/bin/` y lo reutiliza en ejecuciones futuras.
 * - Copia automáticamente la URL `https://.../mcp` al portapapeles.
 */

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const RELEASE_BASE = "https://github.com/cloudflare/cloudflared/releases/latest/download";
const URL_TUNEL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function rutaBinarioCache() {
  const nombre = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  return path.join(os.homedir(), ".spij-mcp", "bin", nombre);
}

function assetCloudflared() {
  const { platform, arch } = process;
  if (platform === "win32") {
    return { archivo: "cloudflared-windows-amd64.exe", esTgz: false };
  }
  if (platform === "darwin") {
    const a = arch === "arm64" ? "arm64" : "amd64";
    return { archivo: `cloudflared-darwin-${a}.tgz`, esTgz: true };
  }
  if (platform === "linux") {
    const mapa = { x64: "amd64", arm64: "arm64", arm: "arm", ia32: "386" };
    return { archivo: `cloudflared-linux-${mapa[arch] || "amd64"}`, esTgz: false };
  }
  throw new Error(`Plataforma no soportada para descarga automática de cloudflared: ${platform}/${arch}`);
}

function comandoDisponible(cmd) {
  return new Promise((resolve) => {
    execFile(cmd, ["--version"], { timeout: 5000 }, (err) => resolve(!err));
  });
}

async function descargarCloudflared(destino) {
  const { archivo, esTgz } = assetCloudflared();
  const url = `${RELEASE_BASE}/${archivo}`;
  const carpeta = path.dirname(destino);
  await fsp.mkdir(carpeta, { recursive: true });

  console.error("[spij-mcp] Descargando cloudflared (solo la primera vez)...");
  const respuesta = await fetch(url, { redirect: "follow" });
  if (!respuesta.ok || !respuesta.body) {
    throw new Error(`No se pudo descargar cloudflared (${respuesta.status} ${respuesta.statusText}).`);
  }

  const temporal = `${destino}.tmp`;
  await pipeline(Readable.fromWeb(respuesta.body), fs.createWriteStream(temporal));

  if (esTgz) {
    await new Promise((resolve, reject) => {
      execFile("tar", ["-xzf", temporal, "-C", carpeta], (err) => (err ? reject(err) : resolve()));
    });
    await fsp.rm(temporal, { force: true });
  } else {
    await fsp.rename(temporal, destino);
  }

  if (process.platform !== "win32") {
    await fsp.chmod(destino, 0o755);
  }
  return destino;
}

/** Devuelve la ruta de `cloudflared` (del sistema, de caché o descargado). */
export async function obtenerCloudflared() {
  if (await comandoDisponible("cloudflared")) {
    return "cloudflared";
  }

  const enCache = rutaBinarioCache();
  if (fs.existsSync(enCache) && (await comandoDisponible(enCache))) {
    return enCache;
  }

  return descargarCloudflared(enCache);
}

/** Copia texto al portapapeles del sistema (silencioso si no hay herramienta). */
export function copiarAlPortapapeles(texto) {
  const intentos =
    process.platform === "win32"
      ? [["clip", []]]
      : process.platform === "darwin"
        ? [["pbcopy", []]]
        : [
            ["wl-copy", []],
            ["xclip", ["-selection", "clipboard"]],
            ["xsel", ["--clipboard", "--input"]],
          ];

  return new Promise((resolve) => {
    const probar = (indice) => {
      if (indice >= intentos.length) return resolve(false);
      const [cmd, args] = intentos[indice];
      const hijo = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
      hijo.once("error", () => probar(indice + 1));
      hijo.once("close", (codigo) => (codigo === 0 ? resolve(true) : probar(indice + 1)));
      hijo.stdin.end(texto);
    };
    probar(0);
  });
}

/**
 * Abre un Cloudflare Quick Tunnel apuntando a `urlLocal` y espera a que
 * devuelva la URL pública `https://...trycloudflare.com`.
 *
 * @param {string} urlLocal  Por ejemplo "http://127.0.0.1:3000"
 * @param {object} [opciones]
 * @param {number} [opciones.timeoutMs]
 * @returns {Promise<{ urlPublica: string, urlMcp: string, cerrar: () => void }>}
 */
export async function abrirTunel(urlLocal, { timeoutMs = 30000 } = {}) {
  const binario = await obtenerCloudflared();
  const hijo = spawn(binario, ["tunnel", "--url", urlLocal, "--no-autoupdate"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const cerrar = () => {
    if (!hijo.killed) {
      hijo.kill();
    }
  };

  const urlPublica = await new Promise((resolve, reject) => {
    let resuelto = false;
    let ultimasLineas = "";

    const temporizador = setTimeout(() => {
      if (!resuelto) {
        cerrar();
        reject(new Error(`El túnel tardó demasiado en iniciar.\n${ultimasLineas.trim()}`));
      }
    }, timeoutMs);

    const procesar = (chunk) => {
      const texto = chunk.toString("utf8");
      ultimasLineas = (ultimasLineas + texto).slice(-1500);
      const match = texto.match(URL_TUNEL_RE);
      if (match && !resuelto) {
        resuelto = true;
        clearTimeout(temporizador);
        resolve(match[0]);
      }
    };

    hijo.stdout.on("data", procesar);
    hijo.stderr.on("data", procesar);

    hijo.once("error", (err) => {
      if (!resuelto) {
        resuelto = true;
        clearTimeout(temporizador);
        reject(err);
      }
    });

    hijo.once("exit", (codigo) => {
      if (!resuelto) {
        resuelto = true;
        clearTimeout(temporizador);
        reject(new Error(`cloudflared terminó inesperadamente (código ${codigo}).\n${ultimasLineas.trim()}`));
      }
    });
  });

  return {
    urlPublica,
    urlMcp: `${urlPublica}/mcp`,
    cerrar,
  };
}
