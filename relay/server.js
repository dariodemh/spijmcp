/**
 * Relay WebSocket <-> Streamable HTTP para spij-mcp.
 *
 * Permite que cada PC tenga una URL HTTPS fija y permanente:
 *   https://spijmcp.dariomorales.com/u/<id>/mcp
 *
 * El relay NO consulta el SPIJ, NO guarda credenciales ni almacena datos:
 * solo reenvía las peticiones MCP por WebSocket hacia la PC conectada.
 */

import crypto from "node:crypto";
import http from "node:http";
import { WebSocketServer } from "ws";

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB
const REQUEST_TIMEOUT_MS = 90_000;
const PING_INTERVAL_MS = 25_000;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

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

/**
 * Crea el servidor HTTP + WebSocket del relay (exportado para pruebas).
 */
export function crearRelay() {
  /** @type {Map<string, { ws: import("ws").WebSocket, secret: string, pending: Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }> }>} */
  const clientes = new Map();

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
    wss.close();
  });

  return { httpServer, wss, clientes };
}

// Arranque directo si se ejecuta `node server.js`
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("server.js")) {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || "0.0.0.0";
  const { httpServer } = crearRelay();

  httpServer.listen(port, host, () => {
    console.log(`[spij-mcp-relay] escuchando en http://${host}:${port}`);
  });

  const cerrar = () => httpServer.close(() => process.exit(0));
  process.once("SIGINT", cerrar);
  process.once("SIGTERM", cerrar);
}
