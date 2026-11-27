/**
 * Relay WebSocket <-> Streamable HTTP para spij-mcp.
 *
 * Permite que cada PC tenga una URL HTTPS fija y permanente:
 *   https://spijmcp.dariomorales.com/u/<id>/mcp
 *
 * El relay NO consulta el SPIJ, NO guarda credenciales ni almacena consultas:
 * solo reenvía las peticiones MCP por WebSocket hacia la PC conectada.
 * Opcionalmente, si se configuran GOATCOUNTER_SITE y GOATCOUNTER_TOKEN,
 * envía métricas agregadas y anónimas (usuarios diarios y conteo por herramienta).
 */

import crypto from "node:crypto";
import http from "node:http";
import { WebSocketServer } from "ws";

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB
const REQUEST_TIMEOUT_MS = 90_000;
const PING_INTERVAL_MS = 25_000;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const NOMBRE_SEG_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_COLA_METRICAS = 500;
const LOTE_METRICAS = 25;
const FLUSH_METRICAS_MS = 15_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

const HEADERS_A_REENVIAR = [
  "content-type",
  "accept",
  "authorization",
  "mcp-session-id",
  "mcp-protocol-version",
];

function aplicarCors(res) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.setHeader(k, v);
  }
}

function responderJson(res, status, datos, extra = {}) {
  aplicarCors(res);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...extra,
  });
  res.end(JSON.stringify(datos));
}

function igualSeguro(a, b) {
  const ba = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Cuerpo demasiado grande"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function diaPeru() {
  // Fecha YYYY-MM-DD en horario de Perú (UTC-5) para agrupar usuarios diarios.
  return new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
}

function sanitizarSegmento(valor, max = 32) {
  return String(valor || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

/**
 * Crea un colector opcional de métricas agregadas hacia GoatCounter (/api/v0/count).
 * Nunca registra argumentos de búsqueda, respuestas ni IDs en claro.
 */
function crearMetricasGoatCounter(config = {}) {
  const siteRaw = String(config.site || "").trim();
  const token = String(config.token || "").trim();
  if (!siteRaw || !token) {
    return {
      registrarUsuario() {},
      registrarPeticionMcp() {},
      flush: async () => {},
      detener: async () => {},
    };
  }

  const base = siteRaw.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const endpoint = `https://${base}/api/v0/count`;
  const fetchImpl = config.fetchImpl || fetch;
  const flushMs = config.flushIntervalMs ?? FLUSH_METRICAS_MS;
  const sal = crypto.randomBytes(16);

  let diaActual = diaPeru();
  const vistosHoy = new Set();
  const cola = [];
  let enviando = false;

  const asegurarDia = () => {
    const hoy = diaPeru();
    if (hoy !== diaActual) {
      diaActual = hoy;
      vistosHoy.clear();
    }
  };

  const claveAnonima = (id, sufijo = "") =>
    crypto.createHmac("sha256", sal).update(`${id}:${sufijo}`).digest("hex").slice(0, 16);

  const encolar = (path, title) => {
    if (cola.length >= MAX_COLA_METRICAS) cola.shift();
    cola.push({ path, title, event: true });
    if (cola.length >= LOTE_METRICAS) {
      void flush();
    }
  };

  const flush = async () => {
    if (enviando || cola.length === 0) return;
    enviando = true;
    const lote = cola.splice(0, LOTE_METRICAS);
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ no_sessions: true, hits: lote }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        console.warn(`[spij-mcp-relay] GoatCounter respondió HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn(`[spij-mcp-relay] Error enviando métricas a GoatCounter: ${err.message}`);
    } finally {
      enviando = false;
      if (cola.length >= LOTE_METRICAS) {
        void flush();
      }
    }
  };

  const timer = setInterval(() => {
    void flush();
  }, flushMs);
  if (typeof timer.unref === "function") timer.unref();

  return {
    registrarUsuario(id) {
      asegurarDia();
      const clave = claveAnonima(id, "usuario");
      if (vistosHoy.has(clave)) return;
      vistosHoy.add(clave);
      encolar("mcp/usuario", "SPIJ MCP: usuario diario");
    },

    registrarPeticionMcp(id, body) {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return;
      }
      const mensajes = Array.isArray(parsed) ? parsed : [parsed];
      for (const msg of mensajes) {
        if (!msg || typeof msg !== "object") continue;

        if (msg.method === "tools/call") {
          const nombre = String(msg.params?.name || "");
          if (NOMBRE_SEG_RE.test(nombre)) {
            encolar(`mcp/tool/${nombre}`, `SPIJ MCP: ${nombre}`);
          }
        } else if (msg.method === "initialize") {
          const cliente = sanitizarSegmento(msg.params?.clientInfo?.name);
          if (cliente) {
            asegurarDia();
            const clave = claveAnonima(id, `cliente:${cliente}`);
            if (!vistosHoy.has(clave)) {
              vistosHoy.add(clave);
              encolar(`mcp/cliente/${cliente}`, `SPIJ MCP cliente: ${cliente}`);
            }
          }
        }
      }
    },

    flush,

    async detener() {
      clearInterval(timer);
      await flush();
    },
  };
}

/**
 * Crea el servidor HTTP + WebSocket del relay (exportado para pruebas).
 *
 * @param {object} [opciones]
 * @param {{ site?: string, token?: string, fetchImpl?: typeof fetch, flushIntervalMs?: number }} [opciones.goatcounter]
 */
export function crearRelay(opciones = {}) {
  /** @type {Map<string, { ws: import("ws").WebSocket, secret: string, pending: Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }> }>} */
  const clientes = new Map();
  const metricas = crearMetricasGoatCounter(
    opciones.goatcounter ?? {
      site: process.env.GOATCOUNTER_SITE,
      token: process.env.GOATCOUNTER_TOKEN,
    },
  );

  const httpServer = http.createServer(async (req, res) => {
    aplicarCors(res);

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const ruta = url.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if ((ruta === "/" || ruta === "/health") && req.method === "GET") {
      responderJson(res, 200, {
        ok: true,
        nombre: "spij-mcp-relay",
        conectados: clientes.size,
      });
      return;
    }

    const match = ruta.match(/^\/u\/([A-Za-z0-9_-]{8,64})\/mcp$/);
    if (!match) {
      responderJson(res, 404, {
        error: "Ruta no encontrada. El endpoint MCP tiene la forma /u/<id>/mcp.",
      });
      return;
    }

    if (req.method !== "POST") {
      responderJson(
        res,
        405,
        {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Método no permitido. Usa POST /u/<id>/mcp." },
          id: null,
        },
        { Allow: "POST, OPTIONS" },
      );
      return;
    }

    const id = match[1];
    const entrada = clientes.get(id);
    if (!entrada || entrada.ws.readyState !== 1) {
      responderJson(res, 503, {
        jsonrpc: "2.0",
        error: {
          code: -32002,
          message:
            "Tu computadora no está conectada a SPIJ MCP. Abre SPIJ MCP en tu PC y vuelve a intentar.",
        },
        id: null,
      });
      return;
    }

    let body;
    try {
      body = await leerCuerpo(req);
    } catch {
      responderJson(res, 413, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Petición demasiado grande." },
        id: null,
      });
      return;
    }

    const headers = {};
    for (const nombre of HEADERS_A_REENVIAR) {
      if (req.headers[nombre]) headers[nombre] = req.headers[nombre];
    }

    const reqId = crypto.randomUUID();
    metricas.registrarPeticionMcp(id, body);
    try {
      const respuesta = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          entrada.pending.delete(reqId);
          reject(new Error("Tiempo de espera agotado esperando respuesta de la PC."));
        }, REQUEST_TIMEOUT_MS);

        entrada.pending.set(reqId, { resolve, reject, timer });
        entrada.ws.send(
          JSON.stringify({
            type: "http_request",
            reqId,
            method: req.method,
            path: "/mcp",
            headers,
            body,
          }),
          (err) => {
            if (err) {
              clearTimeout(timer);
              entrada.pending.delete(reqId);
              reject(err);
            }
          },
        );
      });

      aplicarCors(res);
      const headersSalida = {};
      if (respuesta.headers && typeof respuesta.headers === "object") {
        for (const [k, v] of Object.entries(respuesta.headers)) {
          const clave = k.toLowerCase();
          if (clave === "content-type" || clave === "mcp-session-id") {
            headersSalida[k] = v;
          }
        }
      }
      if (!headersSalida["content-type"] && !headersSalida["Content-Type"]) {
        headersSalida["Content-Type"] = "application/json; charset=utf-8";
      }

      res.writeHead(respuesta.status || 200, headersSalida);
      res.end(respuesta.body ?? "");
    } catch (error) {
      if (!res.headersSent) {
        responderJson(res, 504, {
          jsonrpc: "2.0",
          error: { code: -32003, message: error.message || "Error al comunicar con la PC." },
          id: null,
        });
      }
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY_BYTES + 65536 });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname !== "/connect") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    let clienteId = null;

    const timerRegistro = setTimeout(() => {
      if (!clienteId) ws.close(4001, "Registro no recibido a tiempo");
    }, 10_000);

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }

      if (msg.type === "ping") {
        ws.isAlive = true;
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      if (msg.type === "register") {
        clearTimeout(timerRegistro);
        const { id, secret } = msg;
        if (!ID_RE.test(String(id || "")) || typeof secret !== "string" || secret.length < 16) {
          ws.send(JSON.stringify({ type: "error", message: "Credenciales de registro inválidas." }));
          ws.close(4002, "Registro inválido");
          return;
        }

        const existente = clientes.get(id);
        if (existente) {
          if (!igualSeguro(existente.secret, secret)) {
            ws.send(JSON.stringify({ type: "error", message: "ID en uso por otra instalación." }));
            ws.close(4003, "ID en uso");
            return;
          }
          // Reconexión legítima del mismo cliente: cerramos el socket viejo.
          for (const p of existente.pending.values()) {
            clearTimeout(p.timer);
            p.reject(new Error("Cliente reconectando."));
          }
          existente.pending.clear();
          try {
            existente.ws.terminate();
          } catch {}
        }

        clienteId = id;
        clientes.set(id, { ws, secret, pending: new Map() });
        metricas.registrarUsuario(id);
        ws.send(JSON.stringify({ type: "registered", id }));
        return;
      }

      if (msg.type === "http_response" && clienteId) {
        const entrada = clientes.get(clienteId);
        const pendiente = entrada?.pending.get(msg.reqId);
        if (!pendiente) return;
        clearTimeout(pendiente.timer);
        entrada.pending.delete(msg.reqId);
        pendiente.resolve(msg);
      }
    });

    ws.on("close", () => {
      clearTimeout(timerRegistro);
      if (!clienteId) return;
      const actual = clientes.get(clienteId);
      if (actual && actual.ws === ws) {
        for (const p of actual.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("La PC se desconectó durante la consulta."));
        }
        actual.pending.clear();
        clientes.delete(clienteId);
      }
    });
  });

  const intervaloPing = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, PING_INTERVAL_MS);

  httpServer.on("close", () => {
    clearInterval(intervaloPing);
    void metricas.detener();
    wss.close();
  });

  return { httpServer, wss, clientes, metricas };
}

// Arranque directo si se ejecuta `node server.js`
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("server.js")) {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || "0.0.0.0";
  const { httpServer, metricas } = crearRelay();

  httpServer.listen(port, host, () => {
    const gcActivo = Boolean(process.env.GOATCOUNTER_SITE && process.env.GOATCOUNTER_TOKEN);
    console.log(
      `[spij-mcp-relay] escuchando en http://${host}:${port}${gcActivo ? ` (GoatCounter: ${process.env.GOATCOUNTER_SITE})` : ""}`,
    );
  });

  const cerrar = () => {
    httpServer.close(async () => {
      await metricas.detener();
      process.exit(0);
    });
  };
  process.once("SIGINT", cerrar);
  process.once("SIGTERM", cerrar);
}
