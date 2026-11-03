/**
 * Prueba del transporte Streamable HTTP. Requiere que el servidor esté
 * levantado, por ejemplo:
 *
 *   MCP_AUTH_TOKEN=secreto node src/server.js --http
 *   MCP_AUTH_TOKEN=secreto node test/mcp-http.js
 *
 *   MCP_URL=http://127.0.0.1:8787/mcp  (por defecto)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL || "http://127.0.0.1:8787/mcp";
const token = process.env.MCP_AUTH_TOKEN || "";

const transporte = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
});

const cliente = new Client({ name: "prueba-http", version: "0.1.0" });
await cliente.connect(transporte);
console.log(`Conectado por Streamable HTTP a ${url}`);

const { tools } = await cliente.listTools();
console.log(`Herramientas disponibles (${tools.length}):`);
for (const t of tools) console.log(` - ${t.name}`);

const busqueda = await cliente.callTool({
  name: "buscar_normas",
  arguments: { texto: "procedimiento administrativo", por_pagina: 2 },
});
const datos = JSON.parse(busqueda.content[0].text);
console.log(`\nBúsqueda 'procedimiento administrativo': total = ${datos.total}`);
for (const r of datos.resultados) {
  console.log(` - ${r.id} | ${r.codigo} | ${r.fecha} | ${(r.sumilla || "").slice(0, 80)}...`);
}

await cliente.close();
console.log("\nPrueba HTTP completada.");
