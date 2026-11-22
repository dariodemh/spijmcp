/**
 * Transporte Streamable HTTP para el servidor MCP del SPIJ.
 *
 * Permite conectar clientes remotos o de navegador (ChatGPT Desktop/Web,
 * Gemini Web/Enterprise, MCP Inspector, etc.) mediante HTTPS/HTTP.
 *
 * Opera en modo sin estado (stateless): cada petición POST /mcp crea una
 * instancia ligera de McpServer y StreamableHTTPServerTransport, pero todas
 * comparten el mismo SpijClient (sesión SPIJ, cookies y caché de catálogos).
 */

import crypto from "node:crypto";
import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { crearServidor, VERSION } from "./app.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

function aplicarCors(res) {
  for (const [clave, valor] of Object.entries(CORS_HEADERS)) {
    res.setHeader(clave, valor);
  }
}

function responderJson(res, status, datos, headersExtra = {}) {
  aplicarCors(res);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headersExtra,
  });
  res.end(JSON.stringify(datos));
}

function tokenValido(req, tokenEsperado) {
  if (!tokenEsperado) return true;
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return false;
  const recibido = Buffer.from(auth.slice(7));
  const esperado = Buffer.from(tokenEsperado);
  if (recibido.length !== esperado.length) return false;
  return crypto.timingSafeEqual(recibido, esperado);
}

/**
 * Crea un servidor Node.js HTTP que expone el MCP del SPIJ en `/mcp`
 * y un endpoint de estado en `/` y `/health`.
 *
 * @param {import("./spij.js").SpijClient} cliente
 * @param {object} [opciones]
 * @param {string} [opciones.repo]
 * @param {string} [opciones.instructions]
 * @param {string} [opciones.token]             Token Bearer opcional para proteger /mcp.
 * @param {boolean} [opciones.permitirExportar] Habilita exportar_documento (por defecto true).
 */
export function crearServidorHttp(cliente, opciones = {}) {
  const { repo, instructions, token = "", permitirExportar = true } = opciones;

  return http.createServer(async (req, res) => {
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
        nombre: "spij-mcp",
        version: VERSION,
        transporte: "streamable-http",
        modo: cliente.modo,
        endpoint: "/mcp",
        autenticacion: Boolean(token),
      });
      return;
    }

    if (ruta !== "/mcp") {
      responderJson(res, 404, {
        error: "Ruta no encontrada. El endpoint MCP está en /mcp.",
      });
      return;
    }

    if (!tokenValido(req, token)) {
      responderJson(
        res,
        401,
        {
          jsonrpc: "2.0",
          error: { code: -32001, message: "No autorizado: se requiere Authorization: Bearer <token>." },
          id: null,
        },
        { "WWW-Authenticate": "Bearer" },
      );
      return;
    }

    if (req.method !== "POST") {
      responderJson(
        res,
        405,
        {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Método no permitido en modo sin estado. Usa POST /mcp." },
          id: null,
        },
        { Allow: "POST, OPTIONS" },
      );
      return;
    }

    const server = crearServidor(cliente, { repo, instructions, permitirExportar });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("[spij-mcp] error en petición HTTP:", error);
      if (!res.headersSent) {
        responderJson(res, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Error interno del servidor MCP." },
          id: null,
        });
      }
    }
  });
}
