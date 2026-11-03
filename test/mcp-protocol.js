/**
 * Prueba del protocolo MCP en memoria: crea el servidor y un cliente MCP
 * enlazados en el mismo proceso, lista las herramientas y ejecuta algunas.
 * Verifica el registro de herramientas y las respuestas, sin depender de
 * stdio ni de la red local.
 *
 *   node test/mcp-protocol.js
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { crearCliente, crearServidor } from "../src/app.js";

const clienteSpij = crearCliente({ intervaloMinimoMs: 300 });
const servidor = crearServidor(clienteSpij);

const [transporteServidor, transporteCliente] = InMemoryTransport.createLinkedPair();
await servidor.connect(transporteServidor);

const cliente = new Client({ name: "prueba-spij", version: "0.1.0" });
await cliente.connect(transporteCliente);
console.log("Conectado por transporte en memoria.");

const { tools } = await cliente.listTools();
console.log(`Herramientas disponibles (${tools.length}):`);
for (const t of tools) console.log(` - ${t.name}: ${t.description.split(".")[0]}`);

const diag = await cliente.callTool({ name: "diagnostico_spij", arguments: {} });
console.log("\nDiagnóstico:");
console.log(diag.content?.[0]?.text);

const busqueda = await cliente.callTool({
  name: "buscar_jurisprudencia",
  arguments: { texto: "despido arbitrario", por_pagina: 2 },
});
const datos = JSON.parse(busqueda.content[0].text);
console.log("\nBúsqueda 'despido arbitrario': total =", datos.total);
for (const r of datos.resultados) {
  console.log(` - ${r.id} | ${r.codigo} | ${r.fecha} | ${(r.sumilla || "").slice(0, 90)}...`);
}

const detalle = await cliente.callTool({
  name: "obtener_documento",
  arguments: { id: datos.resultados[0].id, max_caracteres: 2000 },
});
const doc = JSON.parse(detalle.content[0].text);
console.log("\nDetalle:", doc.id, "| texto_disponible:", doc.texto_disponible);
console.log("Aviso:", doc.aviso ?? "(texto completo disponible)");

const upd = await cliente.callTool({ name: "comprobar_actualizacion", arguments: {} });
const actualizacion = JSON.parse(upd.content[0].text);
console.log("Actualización configurada:", actualizacion.configurado, "| ultima:", actualizacion.ultima ?? "—");

if (tools.length !== 7) throw new Error(`Se esperaban 7 herramientas y hay ${tools.length}`);
if (!datos.total) throw new Error("La búsqueda no devolvió resultados");
if (!doc.id) throw new Error("El detalle no devolvió documento");

await cliente.close();
await servidor.close();
console.log("\nPrueba de protocolo completada.");
