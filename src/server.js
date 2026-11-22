#!/usr/bin/env node
/**
 * Servidor MCP para el SPIJ.
 *
 * Modos de transporte:
 *   - stdio (por defecto): Claude Desktop, Claude Code, Gemini CLI, Codex, Cursor, etc.
 *   - Streamable HTTP (--http o SPIJ_MCP_TRANSPORT=http): ChatGPT Desktop/Web,
 *     Gemini Web/Enterprise y cualquier cliente MCP por HTTP/HTTPS.
 *   - Túnel local automático (--tunnel): inicia HTTP local + túnel HTTPS de
 *     Cloudflare en un solo paso y copia la URL `/mcp` al portapapeles.
 *
 * Opciones CLI (en modo HTTP / túnel):
 *   --http                Inicia el servidor Streamable HTTP en /mcp.
 *   --tunnel              Inicia HTTP local + túnel HTTPS automático (implica --http).
 *   --port <puerto>       Puerto HTTP (por defecto: PORT, SPIJ_MCP_PORT o 3000).
 *   --host <ip>           Dirección de escucha (por defecto: HOST, SPIJ_MCP_HOST o 127.0.0.1).
 *   --token <secreto>     Token Bearer opcional para proteger /mcp (o SPIJ_MCP_TOKEN).
 *   --sin-exportar        Desactiva exportar_documento (útil en despliegues en la nube).
 *
 * Variables de entorno:
 *   SPIJ_USUARIO / SPIJ_CLAVE  Cuenta suscriptora del SPIJ (opcional).
 *   SPIJ_MCP_REPO              Repositorio GitHub "usuario/repo" para actualizaciones.
 *   SPIJ_MCP_CHECK_UPDATES     "0" desactiva la comprobación al arrancar.
 *   SPIJ_MCP_TRANSPORT         "http" para iniciar en modo Streamable HTTP.
 *   SPIJ_MCP_PORT / PORT       Puerto HTTP (por defecto 3000).
 *   SPIJ_MCP_HOST / HOST       Host HTTP (por defecto 127.0.0.1).
 *   SPIJ_MCP_TOKEN             Token Bearer opcional para /mcp.
 *   SPIJ_MCP_SIN_EXPORTAR      "1" desactiva exportar_documento.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { crearCliente, crearServidor, VERSION } from "./app.js";
import { RELAY_POR_DEFECTO, resolverRepo } from "./config.js";
import { crearServidorHttp } from "./http.js";
import { conectarRelay } from "./relay-client.js";
import { abrirTunel, copiarAlPortapapeles } from "./tunnel.js";
import { comprobarActualizacion } from "./updates.js";

function leerOpcionesCli(argv) {
  const puertoEnv = process.env.SPIJ_MCP_PORT || process.env.PORT;
  const opciones = {
    http: (process.env.SPIJ_MCP_TRANSPORT || "").toLowerCase() === "http",
    tunnel: false,
    relay: process.env.SPIJ_MCP_RELAY || "",
    port: Number(puertoEnv || 3000),
    puertoExplicito: Boolean(puertoEnv),
    host: process.env.SPIJ_MCP_HOST || process.env.HOST || "127.0.0.1",
    token: process.env.SPIJ_MCP_TOKEN || "",
    permitirExportar: process.env.SPIJ_MCP_SIN_EXPORTAR !== "1",
  };
  if (opciones.relay) opciones.http = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--http") {
      opciones.http = true;
    } else if (arg === "--tunnel") {
      opciones.tunnel = true;
      opciones.http = true;
    } else if (arg === "--relay") {
      opciones.http = true;
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        opciones.relay = argv[++i];
      } else {
        opciones.relay = RELAY_POR_DEFECTO;
      }
    } else if (arg.startsWith("--relay=")) {
      opciones.http = true;
      opciones.relay = arg.slice(8) || RELAY_POR_DEFECTO;
    } else if (arg === "--port" && argv[i + 1]) {
      opciones.port = Number(argv[++i]);
      opciones.puertoExplicito = true;
    } else if (arg.startsWith("--port=")) {
      opciones.port = Number(arg.slice(7));
      opciones.puertoExplicito = true;
    } else if (arg === "--host" && argv[i + 1]) {
      opciones.host = argv[++i];
    } else if (arg.startsWith("--host=")) {
      opciones.host = arg.slice(7);
    } else if (arg === "--token" && argv[i + 1]) {
      opciones.token = argv[++i];
    } else if (arg.startsWith("--token=")) {
      opciones.token = arg.slice(8);
    } else if (arg === "--sin-exportar") {
      opciones.permitirExportar = false;
    }
  }

  return opciones;
}

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

async function escucharHttp(httpServer, host, port, permitirPuertoLibre) {
  try {
    await new Promise((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(port, host, resolve);
    });
  } catch (error) {
    if (permitirPuertoLibre && error?.code === "EADDRINUSE") {
      await new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(0, host, resolve);
      });
    } else {
      throw error;
    }
  }
  const direccion = httpServer.address();
  return typeof direccion === "object" && direccion ? direccion.port : port;
}

async function iniciar() {
  const opciones = leerOpcionesCli(process.argv.slice(2));
  const instructions = await notaActualizacion();

  if (opciones.http) {
    const httpServer = crearServidorHttp(cliente, {
      repo,
      instructions,
      token: opciones.token,
      permitirExportar: opciones.permitirExportar,
    });

    const puerto = await escucharHttp(
      httpServer,
      opciones.host,
      opciones.port,
      (opciones.tunnel || Boolean(opciones.relay)) && !opciones.puertoExplicito,
    );

    const urlLocal = `http://${opciones.host}:${puerto}`;
    let puente = null;

    const cerrar = () => {
      if (puente) puente.cerrar();
      httpServer.close(() => process.exit(0));
    };
    process.once("SIGINT", cerrar);
    process.once("SIGTERM", cerrar);

    if (opciones.relay) {
      console.error(`[spij-mcp] v${VERSION} escuchando localmente en ${urlLocal}/mcp`);
      console.error(`[spij-mcp] Conectando al relay ${opciones.relay}...`);
      puente = await conectarRelay(urlLocal, {
        relayUrl: opciones.relay,
        onEstado: ({ estado, detalle }) => {
          if (estado === "reconectando") {
            console.error(`[spij-mcp] Conexión perdida con el relay. ${detalle || ""}`);
          } else if (estado === "conectado" && puente) {
            console.error("[spij-mcp] Reconectado al relay.");
          }
        },
      });
      const copiado = await copiarAlPortapapeles(puente.urlMcp);

      console.error("");
      console.error("============================================================");
      console.error("  SPIJ MCP listo para ChatGPT / Gemini (URL fija permanente)");
      console.error(`  URL: ${puente.urlMcp}`);
      if (copiado) {
        console.error("  (Copiada al portapapeles: pégala con Ctrl+V una sola vez)");
      }
      if (opciones.token) {
        console.error("  Autenticación: Bearer token activado");
      }
      console.error(`  Modo de acceso SPIJ: ${cliente.modo}`);
      console.error("  Deja esta ventana abierta mientras uses el SPIJ.");
      console.error("  Presiona Ctrl+C o cierra esta ventana para detener.");
      console.error("============================================================");
      console.error("");
      return;
    }

    if (opciones.tunnel) {
      console.error(`[spij-mcp] v${VERSION} escuchando localmente en ${urlLocal}/mcp`);
      console.error("[spij-mcp] Abriendo túnel HTTPS...");
      puente = await abrirTunel(urlLocal);
      const copiado = await copiarAlPortapapeles(puente.urlMcp);

      console.error("");
      console.error("============================================================");
      console.error("  SPIJ MCP listo para ChatGPT / Gemini");
      console.error(`  URL: ${puente.urlMcp}`);
      if (copiado) {
        console.error("  (Copiada al portapapeles: pégala con Ctrl+V)");
      }
      if (opciones.token) {
        console.error("  Autenticación: Bearer token activado");
      }
      console.error(`  Modo de acceso SPIJ: ${cliente.modo}`);
      console.error("  Deja esta ventana abierta mientras uses el SPIJ.");
      console.error("  Presiona Ctrl+C o cierra esta ventana para detener.");
      console.error("============================================================");
      console.error("");
      return;
    }

    console.error(
      `[spij-mcp] v${VERSION} listo por Streamable HTTP en ${urlLocal}/mcp (modo de acceso: ${cliente.modo}${opciones.token ? ", con token" : ""}${opciones.permitirExportar ? "" : ", sin exportar"})`,
    );
    return;
  }

  const server = crearServidor(cliente, {
    repo,
    instructions,
    permitirExportar: opciones.permitirExportar,
  });
  await server.connect(new StdioServerTransport());
  console.error(
    `[spij-mcp] v${VERSION} listo por stdio (modo de acceso: ${cliente.modo}${repo ? `, repo: ${repo}` : ""})`,
  );
}

iniciar().catch((error) => {
  console.error("[spij-mcp] no se pudo iniciar:", error);
  process.exit(1);
});
