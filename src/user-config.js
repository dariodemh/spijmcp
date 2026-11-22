/**
 * Configuración local persistente de spij-mcp en `~/.spij-mcp/`:
 *   - `config.json`: credenciales opcionales del suscriptor SPIJ (solo en esta PC).
 *   - `ui-state.json`: puerto y PID de la instancia activa del panel local.
 *
 * También gestiona el inicio automático con Windows (HKCU\...\Run, sin requerir
 * permisos de administrador).
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLAVE_RUN_WINDOWS = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const NOMBRE_RUN_WINDOWS = "SPIJ-MCP";

export function directorioDatosUsuario() {
  return path.join(os.homedir(), ".spij-mcp");
}

export function rutaConfigUsuario() {
  return path.join(directorioDatosUsuario(), "config.json");
}

export function rutaEstadoUi() {
  return path.join(directorioDatosUsuario(), "ui-state.json");
}

export function carpetaDescargasSpij() {
  return path.join(os.homedir(), "Downloads", "SPIJ");
}

/**
 * Lee las credenciales guardadas en `~/.spij-mcp/config.json` (síncrono, para
 * usarlo al construir el cliente SPIJ en arranque).
 */
export function leerCredencialesGuardadas(ruta = rutaConfigUsuario()) {
  try {
    if (!fs.existsSync(ruta)) return { usuario: "", clave: "" };
    const datos = JSON.parse(fs.readFileSync(ruta, "utf8"));
    const usuario = typeof datos?.usuario === "string" ? datos.usuario.trim() : "";
    const clave = typeof datos?.clave === "string" ? datos.clave : "";
    return { usuario, clave };
  } catch {
    return { usuario: "", clave: "" };
  }
}

/**
 * Guarda (o limpia si están vacías) las credenciales del SPIJ en disco local
 * con permisos restrictivos (`0600`).
 */
export async function guardarCredenciales({ usuario = "", clave = "" }, ruta = rutaConfigUsuario()) {
  const u = String(usuario || "").trim();
  const c = String(clave || "");

  await fsp.mkdir(path.dirname(ruta), { recursive: true });

  if (!u || !c) {
    try {
      await fsp.unlink(ruta);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return { usuario: "", clave: "" };
  }

  await fsp.writeFile(
    ruta,
    JSON.stringify({ usuario: u, clave: c }, null, 2),
    { encoding: "utf8", mode: 0o600 },
  );
  return { usuario: u, clave: c };
}

/** Guarda el estado de la instancia UI activa para que el lanzador pueda abrirla. */
export async function escribirEstadoUi(estado, ruta = rutaEstadoUi()) {
  await fsp.mkdir(path.dirname(ruta), { recursive: true });
  await fsp.writeFile(ruta, JSON.stringify(estado, null, 2), { encoding: "utf8" });
}

/** Elimina el archivo de estado UI al cerrar limpiamente. */
export function limpiarEstadoUiSync(ruta = rutaEstadoUi()) {
  try {
    if (fs.existsSync(ruta)) fs.unlinkSync(ruta);
  } catch {
    // Ignorar errores al cerrar.
  }
}

/** ¿Está configurado SPIJ-MCP para iniciar automáticamente con Windows? */
export async function obtenerInicioWindows() {
  if (process.platform !== "win32") return { disponible: false, activo: false };
  const rutaExe = process.env.SPIJ_MCP_EXE || "";
  if (!rutaExe) return { disponible: false, activo: false };

  try {
    await execFileAsync("reg.exe", ["query", CLAVE_RUN_WINDOWS, "/v", NOMBRE_RUN_WINDOWS], {
      windowsHide: true,
    });
    return { disponible: true, activo: true };
  } catch {
    return { disponible: true, activo: false };
  }
}

/** Activa o desactiva el inicio automático en Windows (solo usuario actual). */
export async function configurarInicioWindows(habilitar, rutaExe = process.env.SPIJ_MCP_EXE || "") {
  if (process.platform !== "win32" || !rutaExe) {
    return { disponible: false, activo: false };
  }

  if (habilitar) {
    const comando = `"${rutaExe}" --minimized`;
    await execFileAsync(
      "reg.exe",
      ["add", CLAVE_RUN_WINDOWS, "/v", NOMBRE_RUN_WINDOWS, "/t", "REG_SZ", "/d", comando, "/f"],
      { windowsHide: true },
    );
    return { disponible: true, activo: true };
  }

  try {
    await execFileAsync(
      "reg.exe",
      ["delete", CLAVE_RUN_WINDOWS, "/v", NOMBRE_RUN_WINDOWS, "/f"],
      { windowsHide: true },
    );
  } catch {
    // Si ya no existía la entrada, se considera desactivado.
  }
  return { disponible: true, activo: false };
}
