/**
 * Pruebas de la comprobación de actualizaciones.
 *
 *   node test/updates.js
 *
 * La consulta a GitHub usa un repositorio público de ejemplo; si GitHub
 * limita las peticiones (HTTP 403) la prueba lo avisa y no falla.
 */

import { compararVersiones, comprobarActualizacion } from "../src/updates.js";

let fallos = 0;

function bien(condicion, mensaje) {
  if (condicion) {
    console.log(`  ok  ${mensaje}`);
  } else {
    fallos += 1;
    console.error(`  FALLA  ${mensaje}`);
  }
}

console.log("== Comparación de versiones ==");
bien(compararVersiones("0.1.0", "0.1.0") === 0, "versiones iguales");
bien(compararVersiones("0.1.1", "0.1.0") === 1, "parche mayor");
bien(compararVersiones("0.1.0", "0.2.0") === -1, "menor mayor");
bien(compararVersiones("v1.0.0", "0.9.9") === 1, "prefijo v");
bien(compararVersiones("1.0.0-rc.1", "1.0.0") === -1, "previa menor que final");

console.log("\n== Repositorio sin configurar ==");
const sinRepo = await comprobarActualizacion({ repo: "TU-USUARIO/spij-mcp" });
bien(sinRepo.configurado === false, "detecta el repositorio de ejemplo como no configurado");

console.log("\n== Consulta real a GitHub (repositorio de ejemplo) ==");
const real = await comprobarActualizacion({
  repo: "modelcontextprotocol/typescript-sdk",
  forzar: true,
  timeoutMs: 10000,
});
if (real.error) {
  if (/limitó/.test(real.error)) {
    console.log(`  omitida  GitHub limitó las peticiones: ${real.error}`);
  } else {
    fallos += 1;
    console.error(`  FALLA  ${real.error}`);
  }
} else {
  console.log("  ", JSON.stringify(real));
  bien(real.configurado === true, "consulta configurada");
  bien(Boolean(real.ultima), "devuelve la última versión publicada");
  bien(typeof real.hay_actualizacion === "boolean", "calcula si hay actualización");
}

console.log(
  fallos === 0
    ? "\nComprobación de actualizaciones correcta."
    : `\n${fallos} comprobación(es) fallaron.`,
);
process.exitCode = fallos === 0 ? 0 : 1;
