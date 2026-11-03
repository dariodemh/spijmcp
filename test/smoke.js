/**
 * Prueba de humo contra la API real del SPIJ (requiere internet).
 *
 *   npm run smoke
 *
 * Comprueba autenticación, búsqueda de normas, búsqueda de jurisprudencia,
 * detalle de documento y catálogos. No necesita credenciales: usa el acceso
 * libre, igual que el botón "ACCESO LIBRE" del sitio.
 */

import { SpijClient } from "../src/spij.js";

const cliente = new SpijClient({ intervaloMinimoMs: 400 });

let fallos = 0;

function bien(condicion, mensaje) {
  if (condicion) {
    console.log(`  ok  ${mensaje}`);
  } else {
    fallos += 1;
    console.error(`  FALLA  ${mensaje}`);
  }
}

function titulo(t) {
  console.log(`\n== ${t} ==`);
}

async function principal() {
  titulo("Diagnóstico");
  const diag = await cliente.diagnostico();
  console.log("  ", JSON.stringify(diag));
  bien(diag.modo === "libre" || diag.modo === "suscriptor", "modo de acceso definido");
  bien(diag.normas_en_indice > 1000, "el índice de normas responde");
  bien(diag.jurisprudencia_en_indice > 1000, "el índice de jurisprudencia responde");

  titulo("Búsqueda de normas: 'contrato' (página 2)");
  const normas = await cliente.buscarNormas({
    texto: "contrato",
    desde: 5,
    hasta: 10,
  });
  console.log("   total:", normas.total);
  console.log("   primero:", JSON.stringify(normas.resultados[0], null, 2));
  bien(normas.total > 100, "hay resultados de normas");
  bien(normas.resultados.length === 5, "devuelve 5 resultados");
  bien(Boolean(normas.resultados[0]?.id), "los resultados traen id");
  bien(Boolean(normas.resultados[0]?.url), "los resultados traen URL");

  titulo("Búsqueda de jurisprudencia: 'casación' + tipo CASACION + rango de fechas");
  const juris = await cliente.buscarJurisprudencia({
    texto: "casación",
    tipoDispositivo: "CASACION",
    fechaDesde: "2025-01-01",
    fechaHasta: "2026-10-31",
    desde: 0,
    hasta: 3,
  });
  console.log("   total:", juris.total);
  console.log("   primero:", JSON.stringify(juris.resultados[0], null, 2));
  bien(juris.total > 0, "hay resultados de jurisprudencia");
  bien(juris.resultados.length === 3, "devuelve 3 resultados");
  bien(
    juris.resultados.every((r) => r.fecha >= "2025-01-01" && r.fecha <= "2026-10-31"),
    "el filtro de fechas se aplica",
  );

  titulo("Detalle de un documento de jurisprudencia");
  const detalle = await cliente.obtenerDocumento(juris.resultados[0].id);
  console.log("   id:", detalle.id, "| texto_disponible:", detalle.texto_disponible);
  console.log("   sumilla:", (detalle.sumilla || "").slice(0, 160), "...");
  bien(detalle.id === juris.resultados[0].id, "el detalle corresponde al id pedido");
  bien(Boolean(detalle.sumilla), "el detalle trae sumilla");
  bien(
    detalle.texto_disponible === true || Boolean(detalle.aviso),
    "el acceso al texto completo se informa correctamente",
  );

  titulo("Catálogos");
  const catalogos = await cliente.catalogos();
  console.log(
    "   agrupaciones:",
    catalogos.agrupaciones.length,
    "| tipos de dispositivo:",
    catalogos.tipos_dispositivo_legal.length,
    "| sectores:",
    catalogos.sectores.length,
    "| materias:",
    Object.keys(catalogos.materias).length,
  );
  bien(catalogos.tipos_dispositivo_legal.length > 50, "catálogo de tipos de dispositivo");
  bien(catalogos.sectores.length > 10, "catálogo de sectores");

  titulo("Filtro por sector");
  const sector = catalogos.sectores.find((s) => /MINISTERIO/i.test(s.nombre || ""));
  if (sector) {
    const porSector = await cliente.buscarNormas({
      texto: "",
      sector: sector.nombre,
      desde: 0,
      hasta: 2,
    });
    console.log(`   sector "${sector.nombre}" -> total ${porSector.total}`);
    bien(porSector.total >= 0, "la búsqueda filtrada por sector responde");
  }

  console.log(
    fallos === 0
      ? "\nTodo correcto: el cliente funciona contra el SPIJ en vivo."
      : `\n${fallos} comprobación(es) fallaron.`,
  );
  process.exitCode = fallos === 0 ? 0 : 1;
}

principal().catch((error) => {
  console.error("\nLa prueba de humo falló:", error);
  process.exitCode = 1;
});
