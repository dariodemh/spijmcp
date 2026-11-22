/**
 * Cliente WebSocket para conectar el servidor HTTP local de spij-mcp al relay
 * y obtener una URL HTTPS fija y permanente:
 *   https://spijmcp.dariomorales.com/u/<id>/mcp
 *
 * Guarda el par { id, secret } en `~/.spij-mcp/relay.json` la primera vez
 * para que la URL nunca cambie al reiniciar la computadora.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PING_INTERVAL_MS = 25_000;

export function rutaIdentidadRelay() {
  return path.join(os.homedir(), ".spij-mcp", "relay.json");
}

/** Lee o crea la identidad permanente { id, secret } de esta computadora. */
export async function obtenerIdentidadRelay(ruta = rutaIdentidadRelay()) {
  if (fs.existsSync(ruta)) {
    try {
      const datos = JSON.parse(await fsp.readFile(ruta, "utf8"));
      if (datos?.id && datos?.secret) return datos;
    } catch {
      // Si el archivo está corrupto, regeneramos uno nuevo.
    }
  }

  const identidad = {
    id: crypto.randomBytes(12).toString("base64url"),
    secret: crypto.randomBytes(24).toString("hex"),
  };

  await fsp.mkdir(path.dirname(ruta), { recursive: true });
  await fsp.writeFile(ruta, JSON.stringify(identidad, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  return identidad;
}

function normalizarUrlRelay(relayUrl) {
  const base = String(relayUrl || "").trim().replace(/\/+$/, "");
  const wsBase = base.replace(/^https:\/\//i, "wss://").replace(/^http:\/\//i, "ws://");
  return {
    httpBase: base.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://"),
    wsUrl: `${wsBase}/connect`,
  };
}

/**
 * Conecta el servidor local `urlLocal` (p. ej. `http://127.0.0.1:3000`) al
 * relay y mantiene la conexión con reconexión automática.
 *
 * @param {string} urlLocal
 * @param {object} opciones
 * @param {string} opciones.relayUrl        URL base del relay (ej. https://spijmcp.dariomorales.com)
 * @param {string} [opciones.rutaIdentidad] Ruta personalizada para relay.json (útil en tests)
 * @param {(estado: { estado: string, urlMcp: string, detalle?: string }) => void} [opciones.onEstado]
 * @returns {Promise<{ id: string, urlMcp: string, cerrar: () => void }>}
 */
export async function conectarRelay(urlLocal, opciones) {
  if (typeof globalThis.WebSocket !== "function") {
    throw new Error("El modo --relay requiere Node.js 22 o superior (WebSocket nativo).");
  }

  const identidad = await obtenerIdentidadRelay(opciones.rutaIdentidad);
  const { httpBase, wsUrl } = normalizarUrlRelay(opciones.relayUrl);
  const urlMcp = `${httpBase}/u/${identidad.id}/mcp`;
  const onEstado = opciones.onEstado || (() => {});
  const reintentarInicio = Boolean(opciones.reintentarInicio);

  let cerrado = false;
  let wsActual = null;
  let timerReconexion = null;
  let timerPing = null;
  let intento = 0;

  let resolverInicial;
  let rechazarInicial;
  let listoInicial = false;
  const promesaInicial = new Promise((resolve, reject) => {
    resolverInicial = resolve;
    rechazarInicial = reject;
  });

  const limpiarTimers = () => {
    if (timerPing) {
      clearInterval(timerPing);
      timerPing = null;
    }
    if (timerReconexion) {
      clearTimeout(timerReconexion);
      timerReconexion = null;
    }
  };

  const manejarPeticion = async (ws, msg) => {
    try {
      // Defensa en profundidad: el relay solo puede invocar el endpoint /mcp,
      // nunca las rutas locales de administración (/ui, /ui/api/*).
      const respuesta = await fetch(`${urlLocal}/mcp`, {
        method: msg.method || "POST",
        headers: msg.headers || {},
        body: msg.body,
      });
      const texto = await respuesta.text();
      const headers = {};
      const ct = respuesta.headers.get("content-type");
      if (ct) headers["content-type"] = ct;
      const sid = respuesta.headers.get("mcp-session-id");
      if (sid) headers["mcp-session-id"] = sid;

      if (ws.readyState === globalThis.WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "http_response",
            reqId: msg.reqId,
            status: respuesta.status,
            headers,
            body: texto,
          }),
        );
      }
    } catch (error) {
      if (ws.readyState === globalThis.WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "http_response",
            reqId: msg.reqId,
            status: 502,
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32603, message: `Error local: ${error.message}` },
              id: null,
            }),
          }),
        );
      }
    }
  };

  const abrir = () => {
    if (cerrado) return;
    onEstado({ estado: intento === 0 ? "conectando" : "reconectando", urlMcp });

    const ws = new globalThis.WebSocket(wsUrl);
    wsActual = ws;

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          type: "register",
          id: identidad.id,
          secret: identidad.secret,
        }),
      );
    });

    ws.addEventListener("message", (evento) => {
      let msg;
      try {
        msg = JSON.parse(String(evento.data));
      } catch {
        return;
      }

      if (msg.type === "registered") {
        intento = 0;
        onEstado({ estado: "conectado", urlMcp });
        if (timerPing) clearInterval(timerPing);
        timerPing = setInterval(() => {
          if (ws.readyState === globalThis.WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, PING_INTERVAL_MS);

        if (!listoInicial) {
          listoInicial = true;
          resolverInicial({
            id: identidad.id,
            urlMcp,
            cerrar,
          });
        }
        return;
      }

      if (msg.type === "error") {
        const err = new Error(msg.message || "Error del relay.");
        onEstado({ estado: "error", urlMcp, detalle: err.message });
        if (!listoInicial) {
          listoInicial = true;
          cerrado = true;
          rechazarInicial(err);
        }
        return;
      }

      if (msg.type === "http_request") {
        manejarPeticion(ws, msg);
      }
    });

    ws.addEventListener("error", () => {
      // El evento close se encarga de reconectar o rechazar.
    });

    ws.addEventListener("close", (ev) => {
      if (timerPing) {
        clearInterval(timerPing);
        timerPing = null;
      }
      if (cerrado) return;

      // Si falló la primera conexión, en modo CLI reportamos rápido para que el usuario lo vea.
      // En modo UI (reintentarInicio), seguimos reintentando (útil al iniciar con Windows sin Wi-Fi aún).
      if (!listoInicial && !reintentarInicio) {
        listoInicial = true;
        rechazarInicial(
          new Error(
            `No se pudo conectar al relay (${httpBase})${ev.reason ? `: ${ev.reason}` : ""}. Verifica que el relay esté activo y que tengas internet.`,
          ),
        );
        return;
      }

      intento += 1;
      const esperaMs = Math.min(15_000, 1000 * 2 ** Math.min(intento - 1, 4));
      onEstado({
        estado: "reconectando",
        urlMcp,
        detalle: `Reintentando en ${Math.round(esperaMs / 1000)}s...`,
      });
      timerReconexion = setTimeout(abrir, esperaMs);
    });
  };

  const cerrar = () => {
    cerrado = true;
    limpiarTimers();
    if (wsActual) {
      try {
        wsActual.close();
      } catch {}
    }
  };

  abrir();
  if (reintentarInicio) {
    listoInicial = true;
    return { id: identidad.id, urlMcp, cerrar };
  }
  return promesaInicial;
}
