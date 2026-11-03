/**
 * Lectura por partes, enlaces y exportación (requiere internet).
 *
 *   node test/export.js
 */

import assert from "node:assert/strict";
import { SpijClient, htmlATexto, pdfsDe } from "../src/spij.js";

// Sin red: entidades, enlaces a normas y a PDF.
const html =
  "<p>Texto &Uacute;nico N&ordm; 1 <a href='/spij-ext-web/detallenorma/H1386858'>Decreto</a> " +
  "<a href='http://spij.minjus.gob.pe/Graficos/x/DS_1.pdf'>PDF</a> <a href='https://otro.com/y.pdf'>otro</a></p>";
assert.equal(
  htmlATexto(html),
  "Texto Único Nº 1 Decreto [H1386858] PDF [http://spij.minjus.gob.pe/Graficos/x/DS_1.pdf] otro [https://otro.com/y.pdf]",
);
assert.deepEqual(pdfsDe(html), ["https://spij.minjus.gob.pe/Graficos/x/DS_1.pdf"]);

const cliente = new SpijClient({ silencio: true });

// TUO del D.Leg. 1034 (D.S. 111-2024-PCM): texto + PDF original.
const parte1 = await cliente.obtenerDocumento("H1386858", { maxChars: 2000 });
const parte2 = await cliente.obtenerDocumento("H1386858", { maxChars: 2000, desde: 2000 });
assert.ok(parte1.total_caracteres > 4000);
assert.ok(parte1.texto.includes("continúa con desde=2000"));
assert.notEqual(parte1.texto.slice(0, 100), parte2.texto.slice(0, 100));
assert.ok(parte1.pdfs.some((u) => u.endsWith("DS_111-2024-PCM.pdf")));

const [word] = await cliente.exportar("H1386858", "word");
assert.equal(word.nombre, "H1386858.doc");
assert.ok(new TextDecoder().decode(word.datos).includes("1034"));

const pdfs = await cliente.exportar("H1386858", "pdf");
assert.ok(pdfs.every((p) => new TextDecoder().decode(p.datos.slice(0, 5)) === "%PDF-"));

// Jurisprudencia reservada a suscriptores: no se exporta con el acceso libre.
await assert.rejects(cliente.exportar("H1451006", "word"), /suscriptores/);

console.log("Exportación: ok");
