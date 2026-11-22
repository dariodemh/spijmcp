/**
 * Prueba completa del relay (relay/server.js + src/relay-client.js + src/http.js):
 * levanta el relay y el servidor MCP local en puertos efímeros, los enlaza por
 * WebSocket y ejecuta llamadas MCP reales a través de `/u/<id>/mcp`.
 *
 *   node test/relay-protocol.js
 */

import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { crearCliente } from "../src/app.js";
import { crearServidorHttp } from "../src/http.js";
import { conectarRelay } from "../src/relay-client.js";
import { crearRelay } from "../relay/server.js";

async function escuchar(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function cerrar(server) {
  await new Promise((resolve) => server.close(resolve));
}

const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "spij-relay-test-"));
const rutaIdentidad = path.join(tmpDir, "relay.json");

const { httpServer: relayServer } = crearRelay();
const relayBase = await escuchar(relayServer);

const clienteSpij = crearCliente({ intervaloMinimoMs: 300 });
const localServer = crearServidorHttp(clienteSpij);
const localBase = await escuchar(localServer);

let puente = null;

try {
  // 1. Health del relay antes de conectar
  const h1 = await (await fetch(`${relayBase}/health`)).json();
  assert.equal(h1.ok, true);
  assert.equal(h1.conectados, 0);

  // 2. Petición a un ID desconectado -> 503
  const resOffline = await fetch(`${relayBase}/u/no-conectado-1234/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(resOffline.status, 503);

  // 3. Conectar el cliente local al relay
  puente = await conectarRelay(localBase, { relayUrl: relayBase, rutaIdentidad });
  console.log("Conectado al relay:", puente.urlMcp);

  const h2 = await (await fetch(`${relayBase}/health`)).json();
  assert.equal(h2.conectados, 1);

  // 4. Conectar un cliente MCP Streamable HTTP contra la URL pública del relay
  const transport = new StreamableHTTPClientTransport(new URL(puente.urlMcp));
  const client = new Client({ name: "prueba-relay", version: "0.1.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  assert.equal(tools.length, 7, `Se esperaban 7 herramientas y hay ${tools.length}`);
  console.log(`Herramientas vía relay (${tools.length}): ${tools.map((t) => t.name).join(", ")}`);

  const diag = await client.callTool({ name: "diagnostico_spij", arguments: {} });
  const datosDiag = JSON.parse(diag.content[0].text);
  assert.ok(datosDiag.normas_en_indice > 0, "Se esperaban normas en el índice");
  console.log("Diagnóstico vía relay OK | modo:", datosDiag.modo, "| normas:", datosDiag.normas_en_indice);

  // 5. Verificar que otro cliente con el mismo ID pero distinto secreto es rechazado
  const rutaFalsa = path.join(tmpDir, "falsa.json");
  await fsp.writeFile(
    rutaFalsa,
    JSON.stringify({ id: puente.id, secret: "secreto-falso-que-no-coincide-123456" }),
  );
  await assert.rejects(
    () => conectarRelay(localBase, { relayUrl: relayBase, rutaIdentidad: rutaFalsa }),
    /ID en uso/i,
  );
  console.log("Protección contra secuestro de ID OK.");

  // 6. Reconexión con la misma identidad -> mantiene la misma URL fija
  const puente2 = await conectarRelay(localBase, { relayUrl: relayBase, rutaIdentidad });
  assert.equal(puente2.urlMcp, puente.urlMcp);
  puente.cerrar();
  puente = puente2;

  const { tools: tools2 } = await client.listTools();
  assert.equal(tools2.length, 7);
  console.log("Reconexión con URL fija OK.");

  await client.close();
} finally {
  if (puente) puente.cerrar();
  await cerrar(localServer);
  await cerrar(relayServer);
  await fsp.rm(tmpDir, { recursive: true, force: true });
}

console.log("\nPrueba de relay completada.");
