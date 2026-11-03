/**
 * Variante para Cloudflare Workers (y otros runtimes con APIs web estándar).
 *
 *   npx wrangler dev src/worker.js
 *   npx wrangler deploy
 *
 * Variables (secrets) que debe definir el Worker:
 *   SPIJ_USUARIO / SPIJ_CLAVE  Cuenta suscriptora del SPIJ (opcional).
 *   MCP_AUTH_TOKEN             Token que deben enviar los clientes (recomendado).
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { crearCliente, crearServidor, VERSION } from "./app.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-API-Key, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
};

let clienteGlobal = null;

function obtenerCliente(env) {
  if (!clienteGlobal) {
    clienteGlobal = crearCliente({
      usuario: env.SPIJ_USUARIO,
      clave: env.SPIJ_CLAVE,
    });
  }
  return clienteGlobal;
}

function json(datos, status = 200, extras = {}) {
  return new Response(JSON.stringify(datos), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extras },
  });
}

function iguales(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diferencia = 0;
  for (let i = 0; i < a.length; i += 1) {
    diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferencia === 0;
}

function autorizado(request, env) {
  if (!env.MCP_AUTH_TOKEN) return true;
  const cabecera = request.headers.get("authorization") || "";
  const token = cabecera.startsWith("Bearer ")
    ? cabecera.slice(7)
    : request.headers.get("x-api-key") || "";
  return iguales(token, env.MCP_AUTH_TOKEN);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/health") {
      return json({
        status: "ok",
        servicio: "spij-mcp",
        version: VERSION,
        runtime: "worker",
      });
    }

    if (url.pathname !== "/mcp" && url.pathname !== "/") {
      return json({ error: "Ruta no encontrada. Usa /mcp." }, 404);
    }

    if (!autorizado(request, env)) {
      return json(
        { error: "No autorizado." },
        401,
        { "WWW-Authenticate": "Bearer" },
      );
    }

    if (request.method !== "POST") {
      return json(
        { error: "Este servidor MCP es sin estado: usa POST con JSON-RPC." },
        405,
        { Allow: "POST, OPTIONS" },
      );
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    const server = crearServidor(obtenerCliente(env), {
      repo: env.SPIJ_MCP_REPO,
    });
    await server.connect(transport);

    try {
      const respuesta = await transport.handleRequest(request);
      const cabeceras = new Headers(respuesta.headers);
      for (const [clave, valor] of Object.entries(CORS)) {
        cabeceras.set(clave, valor);
      }
      return new Response(respuesta.body, {
        status: respuesta.status,
        headers: cabeceras,
      });
    } catch (error) {
      return json(
        {
          jsonrpc: "2.0",
          error: { code: -32603, message: `Error interno: ${error.message}` },
          id: null,
        },
        500,
      );
    } finally {
      server.close().catch(() => {});
    }
  },
};
