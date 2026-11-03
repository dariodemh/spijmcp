#!/usr/bin/env node
/**
 * Servidor MCP para el SPIJ.
 *
 *   node src/server.js            -> transporte stdio (Claude Desktop, Claude Code, etc.)
 *   node src/server.js --http     -> Streamable HTTP en http://0.0.0.0:8787/mcp
 *
 * Variables de entorno:
 *   SPIJ_USUARIO / SPIJ_CLAVE  Cuenta suscriptora del SPIJ (opcional).
 *   SPIJ_MCP_REPO              Repositorio GitHub "usuario/repo" para actualizaciones.
 *   SPIJ_MCP_CHECK_UPDATES     "0" desactiva la comprobación al arrancar.
 *   MCP_AUTH_TOKEN             Token que deben enviar los clientes HTTP (recomendado).
 *   PORT                       Puerto del modo HTTP (por defecto 8787).
 *   MCP_RATE_LIMIT             Peticiones por minuto y por IP (por defecto 120).
 */

import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { crearCliente, crearServidor, VERSION } from "./app.js";
import { resolverRepo } from "./config.js";
import { comprobarActualizacion } from "./updates.js";

const modoHttp =
  process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http";

const cliente = crearCliente();
const repo = resolverRepo(process.env.SPIJ_MCP_REPO);

/** Nota que se añade a las instrucciones del modelo si hay versión nueva. */
async function notaActualizacion() {
  if (!repo || process.env.SPIJ_MCP_CHECK_UPDATES === "0") return "";
  try {
    // Presupuesto corto: no debe retrasar el arranque si la red va lenta.
    const resultado = await comprobarActualizacion({ repo, timeoutMs: 1500 });
    if (resultado?.hay_actualizacion) {
      return `Aviso: hay una versión nueva de esta extensión (${resultado.ultima}); la instalada es ${resultado.actual}. Comenta al usuario que puede actualizarla desde ${resultado.url_release || "el repositorio de GitHub"} o pedirle usar comprobar_actualizacion.`;
    }
  } catch {
    // Silencioso: la comprobación de actualizaciones nunca debe impedir arrancar.
  }
  return "";
}

let opcionesServidor = { repo };

/* ------------------------------------------------------------------ */
/* Modo stdio                                                          */
/* ------------------------------------------------------------------ */

async function iniciarStdio() {
  const nota = await notaActualizacion();
  opcionesServidor = { repo, instructions: nota };
  const server = crearServidor(cliente, opcionesServidor);
  const transporte = new StdioServerTransport();
  await server.connect(transporte);
  console.error(
    `[spij-mcp] v${VERSION} listo por stdio (modo de acceso: ${cliente.modo}${repo ? `, repo: ${repo}` : ""})`,
  );
}

/* ------------------------------------------------------------------ */
/* Modo HTTP                                                           */
/* ------------------------------------------------------------------ */

const tokenEsperado = process.env.MCP_AUTH_TOKEN || "";
const limitePeticiones = Number(process.env.MCP_RATE_LIMIT) || 120;
const balde = new Map(); // ip -> { conteo, reinicio }

function autorizado(req) {
  if (!tokenEsperado) return true;
  const cabecera = req.headers.authorization || "";
  const token = cabecera.startsWith("Bearer ")
    ? cabecera.slice(7)
    : String(req.headers["x-api-key"] || "");
  const a = Buffer.from(token);
  const b = Buffer.from(tokenEsperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

function limitado(ip) {
  const ahora = Date.now();
  const registro = balde.get(ip) || { conteo: 0, reinicio: ahora + 60_000 };
  if (ahora > registro.reinicio) {
    registro.conteo = 0;
    registro.reinicio = ahora + 60_000;
  }
  registro.conteo += 1;
  balde.set(ip, registro);
  return registro.conteo > limitePeticiones;
}

function responderJson(res, status, datos, extraHeaders = {}) {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(cuerpo),
    ...extraHeaders,
  });
  res.end(cuerpo);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-API-Key, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
};

function leerCuerpo(req, limite = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const partes = [];
    req.on("data", (trozo) => {
      total += trozo.length;
      if (total > limite) {
        reject(new Error("Cuerpo de la petición demasiado grande."));
        req.destroy();
        return;
      }
      partes.push(trozo);
    });
    req.on("end", () => {
      const texto = Buffer.concat(partes).toString("utf8");
      if (!texto) return resolve(undefined);
      try {
        resolve(JSON.parse(texto));
      } catch {
        reject(new Error("JSON inválido."));
      }
    });
    req.on("error", reject);
  });
}

async function manejarMcp(req, res) {
  const cuerpo = await leerCuerpo(req);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // sin estado: ideal detrás de un proxy/balanceador
    enableJsonResponse: true,
  });

  const server = crearServidor(cliente, opcionesServidor);
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, cuerpo);
}

async function iniciarHttp() {
  const puerto = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || "0.0.0.0";

  const nota = await notaActualizacion();
  opcionesServidor = { repo, instructions: nota };

  const servidor = http.createServer(async (req, res) => {
    for (const [clave, valor] of Object.entries(CORS)) res.setHeader(clave, valor);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/health") {
      responderJson(res, 200, {
        status: "ok",
        servicio: "spij-mcp",
        version: VERSION,
        modo_acceso: cliente.modo,
        uptime_s: Math.round(process.uptime()),
      });
      return;
    }

    if (url.pathname !== "/mcp" && url.pathname !== "/") {
      responderJson(res, 404, { error: "Ruta no encontrada. Usa /mcp." });
      return;
    }

    const ip = req.socket.remoteAddress || "desconocida";
    if (limitado(ip)) {
      responderJson(res, 429, { error: "Demasiadas peticiones. Intenta en un minuto." });
      return;
    }

    if (!autorizado(req)) {
      responderJson(
        res,
        401,
        { error: "No autorizado." },
        { "WWW-Authenticate": "Bearer" },
      );
      return;
    }

    if (req.method !== "POST") {
      responderJson(
        res,
        405,
        { error: "Este servidor MCP es sin estado: usa POST con JSON-RPC." },
        { Allow: "POST, OPTIONS" },
      );
      return;
    }

    try {
      await manejarMcp(req, res);
    } catch (error) {
      console.error("[spij-mcp] error:", error.message);
      if (!res.headersSent) {
        responderJson(res, 400, {
          jsonrpc: "2.0",
          error: { code: -32700, message: error.message },
          id: null,
        });
      } else {
        res.end();
      }
    }
  });

  servidor.listen(puerto, host, () => {
    console.error(
      `[spij-mcp] HTTP en http://${host}:${puerto}/mcp (modo de acceso: ${cliente.modo})`,
    );
    if (!tokenEsperado) {
      console.error(
        "[spij-mcp] AVISO: MCP_AUTH_TOKEN no está definido; el endpoint es público.",
      );
    }
  });

  const cerrar = () => {
    servidor.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", cerrar);
  process.on("SIGTERM", cerrar);
}

/* ------------------------------------------------------------------ */

const principal = modoHttp ? iniciarHttp : iniciarStdio;
principal().catch((error) => {
  console.error("[spij-mcp] no se pudo iniciar:", error);
  process.exit(1);
});
