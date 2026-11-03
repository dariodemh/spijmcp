#!/usr/bin/env node
/**
 * Servidor MCP para el SPIJ (transporte stdio: Claude Desktop, Claude Code, etc.).
 *
 * Variables de entorno:
 *   SPIJ_USUARIO / SPIJ_CLAVE  Cuenta suscriptora del SPIJ (opcional).
 *   SPIJ_MCP_REPO              Repositorio GitHub "usuario/repo" para actualizaciones.
 *   SPIJ_MCP_CHECK_UPDATES     "0" desactiva la comprobación al arrancar.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { crearCliente, crearServidor, VERSION } from "./app.js";
import { resolverRepo } from "./config.js";
import { comprobarActualizacion } from "./updates.js";

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

async function iniciar() {
  const server = crearServidor(cliente, { repo, instructions: await notaActualizacion() });
  await server.connect(new StdioServerTransport());
  console.error(
    `[spij-mcp] v${VERSION} listo por stdio (modo de acceso: ${cliente.modo}${repo ? `, repo: ${repo}` : ""})`,
  );
}

iniciar().catch((error) => {
  console.error("[spij-mcp] no se pudo iniciar:", error);
  process.exit(1);
});
