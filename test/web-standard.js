/**
 * Prueba del handler para Cloudflare Workers usando APIs web estándar
 * (Request/Response), que Node 18+ también implementa.
 *
 *   node test/web-standard.js
 */

import worker from "../src/worker.js";

const env = {
  MCP_AUTH_TOKEN: process.env.MCP_AUTH_TOKEN || "token-de-prueba",
};

async function rpc(cuerpo, token = env.MCP_AUTH_TOKEN) {
  const respuesta = await worker.fetch(
    new Request("http://worker.local/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(cuerpo),
    }),
    env,
  );
  const texto = await respuesta.text();
  return { status: respuesta.status, datos: JSON.parse(texto) };
}

const salud = await worker.fetch(new Request("http://worker.local/health"), env);
console.log("health:", salud.status, await salud.text());

const sinToken = await rpc(
  { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  null,
);
console.log("sin token:", sinToken.status);

const init = await rpc({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "prueba-worker", version: "1" },
  },
});
console.log("initialize:", init.status, init.datos.result?.serverInfo?.name);

const lista = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
console.log("herramientas:", lista.datos.result?.tools?.length);

const llamada = await rpc({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "buscar_normas", arguments: { texto: "presupuesto público", por_pagina: 2 } },
});
const datos = JSON.parse(llamada.datos.result.content[0].text);
console.log("búsqueda:", llamada.status, "total =", datos.total);
for (const r of datos.resultados) console.log(` - ${r.id} | ${r.codigo} | ${r.fecha}`);

if (init.status !== 200) throw new Error("initialize falló");
if (sinToken.status !== 401) throw new Error("no se exigió el token");
if (lista.datos.result.tools.length !== 7) throw new Error("número de herramientas inesperado");
if (!datos.total) throw new Error("búsqueda sin resultados");

console.log("\nPrueba del runtime web completada.");
