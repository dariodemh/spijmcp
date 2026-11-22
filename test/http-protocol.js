/**
 * Prueba del transporte Streamable HTTP: levanta el servidor HTTP en un puerto
 * efímero, valida /health, CORS, autenticación Bearer opcional, modo sin exportar
 * y ejecuta llamadas MCP reales mediante StreamableHTTPClientTransport.
 *
 *   node test/http-protocol.js
 */

import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { crearCliente } from "../src/app.js";
import { crearServidorHttp } from "../src/http.js";

async function escuchar(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function cerrar(server) {
  await new Promise((resolve) => server.close(resolve));
}

const clienteSpij = crearCliente({ intervaloMinimoMs: 300 });

// 1. Servidor abierto (sin token) + cliente MCP real
const serverAbierto = crearServidorHttp(clienteSpij);
const baseUrl = await escuchar(serverAbierto);

try {
  // Health check
  const resHealth = await fetch(`${baseUrl}/health`);
  assert.equal(resHealth.status, 200);
  const health = await resHealth.json();
  assert.equal(health.ok, true);
  assert.equal(health.transporte, "streamable-http");
  assert.equal(health.endpoint, "/mcp");
  assert.equal(health.autenticacion, false);
  console.log("Health OK:", JSON.stringify(health));

  // CORS preflight
  const resCors = await fetch(`${baseUrl}/mcp`, { method: "OPTIONS" });
  assert.equal(resCors.status, 204);
  assert.equal(resCors.headers.get("access-control-allow-origin"), "*");

  // GET /mcp en modo sin estado -> 405
  const resGet = await fetch(`${baseUrl}/mcp`, { method: "GET" });
  assert.equal(resGet.status, 405);

  // Ruta inexistente -> 404
  const res404 = await fetch(`${baseUrl}/otra`);
  assert.equal(res404.status, 404);

  // Cliente MCP Streamable HTTP
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  const client = new Client({ name: "prueba-http", version: "0.1.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  assert.equal(tools.length, 7, `Se esperaban 7 herramientas y hay ${tools.length}`);
  console.log(`Herramientas por Streamable HTTP (${tools.length}): ${tools.map((t) => t.name).join(", ")}`);

  const diag = await client.callTool({ name: "diagnostico_spij", arguments: {} });
  const datosDiag = JSON.parse(diag.content[0].text);
  assert.ok(datosDiag.normas_en_indice > 0, "Se esperaban normas en el índice");
  console.log("Diagnóstico HTTP OK | modo:", datosDiag.modo, "| normas:", datosDiag.normas_en_indice);

  await client.close();
} finally {
  await cerrar(serverAbierto);
}

// 2. Servidor protegido con token Bearer y sin exportar_documento
const token = "secreto-prueba-spij-123";
const serverProtegido = crearServidorHttp(clienteSpij, {
  token,
  permitirExportar: false,
});
const baseUrlProtegido = await escuchar(serverProtegido);

try {
  // Sin token -> 401
  const resSinToken = await fetch(`${baseUrlProtegido}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(resSinToken.status, 401);

  // Con token incorrecto -> 401
  const resMalToken = await fetch(`${baseUrlProtegido}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer incorrecto",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(resMalToken.status, 401);

  // Con token correcto -> conecta y lista 6 herramientas (sin exportar_documento)
  const transportAuth = new StreamableHTTPClientTransport(new URL(`${baseUrlProtegido}/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });
  const clientAuth = new Client({ name: "prueba-http-auth", version: "0.1.0" });
  await clientAuth.connect(transportAuth);

  const { tools } = await clientAuth.listTools();
  assert.equal(tools.length, 6, `Se esperaban 6 herramientas sin exportar y hay ${tools.length}`);
  assert.ok(!tools.some((t) => t.name === "exportar_documento"), "exportar_documento no debería estar registrada");
  console.log("Autenticación Bearer + --sin-exportar OK.");

  await clientAuth.close();
} finally {
  await cerrar(serverProtegido);
}

console.log("\nPrueba de transporte Streamable HTTP completada.");
