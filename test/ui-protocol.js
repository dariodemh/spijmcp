/**
 * Pruebas unitarias del panel local (/ui y /ui/api/*) sin requerir red.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { crearCliente } from "../src/app.js";
import { crearServidorHttp } from "../src/http.js";
import { crearManejadorUi } from "../src/ui.js";
import { leerCredencialesGuardadas } from "../src/user-config.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spij-ui-test-"));
const rutaConfig = path.join(tmpDir, "config.json");

const cliente = crearCliente({ usuario: "", clave: "", silencio: true });
let salio = false;
const estadoRelay = {
  estado: "conectado",
  urlMcp: "https://spijmcp.dariomorales.com/u/test123/mcp",
  detalle: "",
};

const manejadorExtra = crearManejadorUi({
  cliente,
  obtenerEstadoRelay: () => estadoRelay,
  rutaConfig,
  alSalir: () => {
    salio = true;
  },
  tieneBandeja: true,
});

const server = crearServidorHttp(cliente, { manejadorExtra });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

try {
  // 1. GET /ui devuelve HTML con token CSRF
  const rHtml = await fetch(`${base}/ui`);
  assert.equal(rHtml.status, 200);
  const html = await rHtml.text();
  assert.match(html, /SPIJ MCP/);
  assert.match(
    html,
    /Creado por Dario Morales - <a href="mailto:dariodemh@gmail\.com">dariodemh@gmail\.com<\/a>/,
    "Debe incluir el crédito discreto con guión normal y enlace mailto",
  );
  assert.match(
    html,
    /<a class="btn-apoyo" href="https:\/\/dariomorales\.com\/partidas\/assets\/yape\.jpg" target="_blank" rel="noopener noreferrer">[\s\S]*?Aporte voluntario[\s\S]*?<\/a>/,
    "Debe incluir el botón compacto de aporte voluntario abriendo el QR en pestaña nueva",
  );
  assert.doesNotMatch(
    html,
    /<img[^>]*yape\.jpg/i,
    "No debe incrustar la imagen del QR dentro de la app",
  );
  const matchToken = html.match(/const TOKEN = "([a-f0-9]+)"/);
  assert.ok(matchToken, "Debe incluir token CSRF");
  const token = matchToken[1];
  console.log("  ✓ GET /ui devuelve el panel HTML con token CSRF");

  // 2. Host no local es rechazado con 403 (usando http.request porque fetch ignora Host)
  const statusHost = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/ui/api/estado", headers: { Host: "evil.example.com" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(statusHost, 403);
  console.log("  ✓ Rechaza Host externo con 403");

  // 3. GET /ui/icon.png sirve el ícono
  const rIcon = await fetch(`${base}/ui/icon.png`);
  assert.equal(rIcon.status, 200);
  assert.equal(rIcon.headers.get("content-type"), "image/png");
  console.log("  ✓ GET /ui/icon.png sirve el ícono PNG");

  // 4. GET /ui/api/estado refleja el estado actual
  const rEstado = await fetch(`${base}/ui/api/estado`);
  assert.equal(rEstado.status, 200);
  const estado = await rEstado.json();
  assert.equal(estado.modo, "libre");
  assert.equal(estado.relayEstado, "conectado");
  assert.equal(estado.urlMcp, estadoRelay.urlMcp);
  console.log("  ✓ GET /ui/api/estado devuelve estado y URL fija");

  // 5. POST sin token CSRF es rechazado con 403
  const rSinToken = await fetch(`${base}/ui/api/credenciales`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: "abogado", clave: "secreto" }),
  });
  assert.equal(rSinToken.status, 403);
  console.log("  ✓ POST /ui/api/credenciales sin token → 403");

  // 6. POST con usuario sin clave → 400
  const rIncompleto = await fetch(`${base}/ui/api/credenciales`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-SPIJ-Token": token },
    body: JSON.stringify({ usuario: "abogado", clave: "" }),
  });
  assert.equal(rIncompleto.status, 400);

  // 7. Guardar credenciales actualiza cliente y archivo local
  const rGuardar = await fetch(`${base}/ui/api/credenciales`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-SPIJ-Token": token },
    body: JSON.stringify({ usuario: "abogado", clave: "clave123" }),
  });
  assert.equal(rGuardar.status, 200);
  assert.equal(cliente.modo, "suscriptor");
  assert.deepEqual(leerCredencialesGuardadas(rutaConfig), { usuario: "abogado", clave: "clave123" });
  console.log("  ✓ Guardar credenciales actualiza cliente en vivo y persiste en disco");

  // 8. Limpiar credenciales vuelve a modo libre y borra archivo
  const rLimpiar = await fetch(`${base}/ui/api/credenciales`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-SPIJ-Token": token },
    body: JSON.stringify({ usuario: "", clave: "" }),
  });
  assert.equal(rLimpiar.status, 200);
  assert.equal(cliente.modo, "libre");
  assert.equal(fs.existsSync(rutaConfig), false);
  console.log("  ✓ Limpiar credenciales vuelve a acceso libre y elimina el archivo");

  // 9. POST /ui/api/salir invoca alSalir
  const rSalir = await fetch(`${base}/ui/api/salir`, {
    method: "POST",
    headers: { "X-SPIJ-Token": token },
  });
  assert.equal(rSalir.status, 200);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(salio, true);
  console.log("  ✓ POST /ui/api/salir dispara el cierre limpio");

  console.log("\nUI protocol ok.");
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
