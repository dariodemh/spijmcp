/**
 * Panel local de escritorio para spij-mcp (solo accesible en 127.0.0.1).
 *
 * Ofrece una interfaz amigable para abogados sin necesidad de consola:
 *   - Estado en vivo de la conexión con el relay.
 *   - URL HTTPS fija permanente + botón "Copiar URL".
 *   - Instrucciones rápidas para ChatGPT, Gemini y Claude Web.
 *   - Cuenta suscriptora opcional del SPIJ (guardada solo en esta PC).
 *   - Diagnóstico en vivo del SPIJ, acceso directo a Descargas/SPIJ e inicio
 *     automático con Windows.
 */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "./config.js";
import {
  carpetaDescargasSpij,
  configurarInicioWindows,
  guardarCredenciales,
  obtenerInicioWindows,
} from "./user-config.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUTA_ICONO = path.join(RAIZ, "icon.png");

function esHostLocal(hostHeader) {
  const host = String(hostHeader || "").toLowerCase().trim();
  return (
    host === "127.0.0.1" ||
    host.startsWith("127.0.0.1:") ||
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host === "[::1]" ||
    host.startsWith("[::1]:")
  );
}

async function leerJsonCuerpo(req, maxBytes = 64 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("Cuerpo demasiado grande.");
    chunks.push(chunk);
  }
  if (total === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function responderJson(res, status, datos) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(datos));
}

function abrirCarpetaLocal(carpeta) {
  fs.mkdirSync(carpeta, { recursive: true });
  if (process.platform === "win32") {
    spawn("explorer.exe", [carpeta], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [carpeta], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [carpeta], { detached: true, stdio: "ignore" }).unref();
  }
}

/**
 * Abre la URL del panel local en modo ventana de aplicación (Edge o Chrome)
 * sin barra de direcciones, o en el navegador predeterminado como respaldo.
 */
export function abrirVentanaUi(urlUi) {
  if (process.platform === "win32") {
    const candidatos = [
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    ];
    const navegador = candidatos.find((p) => p && fs.existsSync(p));
    if (navegador) {
      spawn(navegador, [`--app=${urlUi}`, "--window-size=560,780"], {
        detached: true,
        stdio: "ignore",
      }).unref();
      return;
    }
    spawn("cmd.exe", ["/c", "start", "", urlUi], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }

  if (process.platform === "darwin") {
    spawn("open", [urlUi], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [urlUi], { detached: true, stdio: "ignore" }).unref();
  }
}

function renderHtml(tokenUi, tieneBandeja) {
  const tokenJson = JSON.stringify(tokenUi);
  const bandejaTexto = tieneBandeja
    ? "Puedes cerrar esta ventana: SPIJ MCP seguirá conectado en segundo plano junto al reloj de Windows."
    : "Mantén SPIJ MCP abierto mientras trabajas con tu asistente de IA.";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SPIJ MCP</title>
<link rel="icon" href="/ui/icon.png">
<style>
  :root {
    --bg: #f6f8fb;
    --card: #ffffff;
    --ink: #132238;
    --muted: #5a6778;
    --line: #dfe6ef;
    --navy: #12335c;
    --navy-hover: #1b467d;
    --ok-bg: #e7f6ee;
    --ok-ink: #146c43;
    --warn-bg: #fff5e0;
    --warn-ink: #946200;
    --err-bg: #fdecec;
    --err-ink: #a61e22;
    --radius: 12px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--ink);
    line-height: 1.45;
    padding: 18px;
  }
  .wrap { max-width: 520px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
  .header {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 4px 2px;
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { width: 36px; height: 36px; border-radius: 8px; }
  .brand h1 { margin: 0; font-size: 19px; color: var(--navy); letter-spacing: -0.01em; }
  .brand span { font-size: 12px; color: var(--muted); }
  .pill {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 6px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
    background: var(--warn-bg); color: var(--warn-ink);
  }
  .pill.ok { background: var(--ok-bg); color: var(--ok-ink); }
  .pill.err { background: var(--err-bg); color: var(--err-ink); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
  .card {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 16px;
    box-shadow: 0 1px 2px rgba(18, 51, 92, 0.04);
  }
  .card h2 { margin: 0 0 6px; font-size: 14.5px; color: var(--navy); }
  .hint { margin: 0 0 12px; font-size: 13px; color: var(--muted); }
  .url-row { display: flex; gap: 8px; }
  .url-input {
    flex: 1; min-width: 0;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12.5px;
    padding: 10px 11px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: #f9fbfd;
    color: var(--ink);
  }
  button {
    font: inherit; cursor: pointer; border-radius: 8px; border: 1px solid transparent;
    padding: 9px 14px; font-size: 13.5px; font-weight: 600; transition: background .15s, border-color .15s;
  }
  .btn-primary { background: var(--navy); color: #fff; white-space: nowrap; }
  .btn-primary:hover { background: var(--navy-hover); }
  .btn-secondary { background: #fff; color: var(--ink); border-color: var(--line); }
  .btn-secondary:hover { background: #f2f5fa; }
  .btn-danger { background: #fff; color: var(--err-ink); border-color: #f3c4c6; }
  .btn-danger:hover { background: var(--err-bg); }
  .tabs { display: flex; gap: 6px; margin-top: 14px; border-bottom: 1px solid var(--line); padding-bottom: 8px; }
  .tab {
    background: transparent; color: var(--muted); border: 1px solid transparent;
    padding: 5px 10px; font-size: 12.5px; border-radius: 6px;
  }
  .tab.active { background: #eaf1fa; color: var(--navy); border-color: #c9dbf2; }
  .steps { margin: 10px 0 0; padding-left: 18px; font-size: 12.8px; color: var(--ink); }
  .steps li { margin-bottom: 4px; }
  .badge-mode {
    display: inline-block; font-size: 12px; font-weight: 600;
    padding: 3px 9px; border-radius: 999px; background: #edf2f8; color: var(--navy);
  }
  .row-between { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
  label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  input[type="text"], input[type="password"] {
    width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px;
    font: inherit; font-size: 13px;
  }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .status-msg { font-size: 12.5px; margin-top: 8px; color: var(--muted); min-height: 18px; }
  .status-msg.ok { color: var(--ok-ink); }
  .status-msg.err { color: var(--err-ink); }
  .toggle-row {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 8px 0; border-bottom: 1px solid var(--line); margin-bottom: 10px;
  }
  .toggle-row:last-child { border-bottom: 0; margin-bottom: 0; padding-bottom: 0; }
  .toggle-label { font-size: 13.5px; font-weight: 500; }
  .toggle-sub { font-size: 12px; color: var(--muted); }
  .footer { text-align: center; font-size: 12px; color: var(--muted); padding: 2px 6px 8px; }
  .footer a { color: var(--navy); text-decoration: none; }
  .footer a:hover { text-decoration: underline; }
  .footer-credit { margin-top: 6px; font-size: 11px; color: var(--muted); opacity: 0.85; }
  .footer-credit a { color: inherit; }
  .hidden { display: none !important; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="brand">
      <img src="/ui/icon.png" alt="SPIJ MCP">
      <div>
        <h1>SPIJ MCP</h1>
        <span>v${VERSION} · Local en tu PC</span>
      </div>
    </div>
    <div id="pill-estado" class="pill"><span class="dot"></span><span id="txt-estado">Conectando...</span></div>
  </div>

  <div class="card">
    <h2>Tu URL permanente</h2>
    <p class="hint">Pégala <strong>una sola vez</strong> en ChatGPT, Gemini o Claude Web. No cambia al reiniciar tu computadora.</p>
    <div class="url-row">
      <input id="url-mcp" class="url-input" type="text" readonly value="Conectando...">
      <button id="btn-copiar" class="btn-primary" type="button">Copiar URL</button>
    </div>

    <div class="tabs" role="tablist">
      <button class="tab active" type="button" data-tab="chatgpt">ChatGPT</button>
      <button class="tab" type="button" data-tab="gemini">Gemini</button>
      <button class="tab" type="button" data-tab="claude">Claude Web</button>
    </div>
    <ol id="pasos-chatgpt" class="steps">
      <li>Abre <strong>Configuración → Aplicaciones / Conectores</strong> y activa <em>Modo desarrollador</em>.</li>
      <li>Haz clic en <strong>Crear</strong> y pega la URL de arriba en <em>URL del servidor MCP</em>.</li>
      <li>Guarda sin autenticación y listo: ya puedes preguntar por normas y casaciones del SPIJ.</li>
    </ol>
    <ol id="pasos-gemini" class="steps hidden">
      <li>Abre <strong>Gemini</strong> (Desktop o Web) y entra a <em>Developer Mode / Conectores MCP</em>.</li>
      <li>Agrega un nuevo servidor MCP y pega la URL permanente de arriba.</li>
      <li>Guarda y prueba escribiendo: <em>«Ejecuta diagnostico_spij»</em>.</li>
    </ol>
    <ol id="pasos-claude" class="steps hidden">
      <li>En <strong>claude.ai</strong>, ve a <strong>Configuración → Conectores → Agregar conector personalizado</strong>.</li>
      <li>Escribe <em>SPIJ</em> como nombre y pega la URL permanente de arriba.</li>
      <li>(En <strong>Claude Desktop</strong> también puedes usar el instalador <code>.mcpb</code> con doble clic.)</li>
    </ol>
  </div>

  <div class="card">
    <div class="row-between">
      <h2>Cuenta suscriptora del SPIJ (opcional)</h2>
      <span id="badge-modo" class="badge-mode">Acceso libre</span>
    </div>
    <p class="hint" style="margin-top:6px">Sin cuenta ves normas y sumillas. Con tu cuenta del SPIJ también lees el texto completo de casaciones. Se guarda solo en esta PC.</p>
    <form id="form-cred">
      <div class="grid-2">
        <div>
          <label for="inp-usuario">Usuario SPIJ</label>
          <input id="inp-usuario" type="text" autocomplete="username" placeholder="Opcional">
        </div>
        <div>
          <label for="inp-clave">Contraseña</label>
          <input id="inp-clave" type="password" autocomplete="current-password" placeholder="••••••••">
        </div>
      </div>
      <div class="actions">
        <button class="btn-primary" type="submit">Guardar cuenta</button>
        <button id="btn-limpiar-cred" class="btn-secondary hidden" type="button">Usar acceso libre</button>
      </div>
      <div id="msg-cred" class="status-msg"></div>
    </form>
  </div>

  <div class="card">
    <h2>Opciones y diagnóstico</h2>
    <div id="row-autostart" class="toggle-row hidden">
      <div>
        <div class="toggle-label">Iniciar automáticamente con Windows</div>
        <div class="toggle-sub">Arranca en segundo plano sin mostrar esta ventana.</div>
      </div>
      <input id="chk-autostart" type="checkbox" style="width:18px;height:18px;cursor:pointer">
    </div>
    <div class="actions" style="margin-top:4px">
      <button id="btn-diag" class="btn-secondary" type="button">Probar conexión SPIJ</button>
      <button id="btn-descargas" class="btn-secondary" type="button">Abrir Descargas\\SPIJ</button>
      <button id="btn-salir" class="btn-danger" type="button">Detener y salir</button>
    </div>
    <div id="msg-diag" class="status-msg"></div>
  </div>

  <div class="footer">
    <div>${bandejaTexto}</div>
    <div style="margin-top:4px">
      100% local en tu PC ·
      <a href="https://dariomorales.com/es/spij/" target="_blank" rel="noopener noreferrer">Guía</a> ·
      <a href="https://github.com/dariodemh/spijmcp" target="_blank" rel="noopener noreferrer">GitHub</a> ·
      <a href="https://dariomorales.com/partidas/assets/yape.jpg" target="_blank" rel="noopener noreferrer">Aporte voluntario</a>
    </div>
    <div class="footer-credit">
      Creado por Dario Morales - <a href="mailto:dariodemh@gmail.com">dariodemh@gmail.com</a>
    </div>
  </div>
</div>

<script>
const TOKEN = ${tokenJson};
const headersPost = { "Content-Type": "application/json", "X-SPIJ-Token": TOKEN };

const elPill = document.getElementById("pill-estado");
const elTxt = document.getElementById("txt-estado");
const elUrl = document.getElementById("url-mcp");
const elModo = document.getElementById("badge-modo");
const elUsuario = document.getElementById("inp-usuario");
const elClave = document.getElementById("inp-clave");
const btnLimpiar = document.getElementById("btn-limpiar-cred");
const msgCred = document.getElementById("msg-cred");
const msgDiag = document.getElementById("msg-diag");
const rowAutostart = document.getElementById("row-autostart");
const chkAutostart = document.getElementById("chk-autostart");

let primeraCarga = true;

async function refrescarEstado() {
  try {
    const r = await fetch("/ui/api/estado");
    if (!r.ok) return;
    const d = await r.json();

    if (d.urlMcp) elUrl.value = d.urlMcp;

    elPill.className = "pill";
    if (d.relayEstado === "conectado") {
      elPill.classList.add("ok");
      elTxt.textContent = "Conectado";
    } else if (d.relayEstado === "error") {
      elPill.classList.add("err");
      elTxt.textContent = "Sin conexión";
    } else if (d.relayEstado === "reconectando") {
      elTxt.textContent = "Reconectando...";
    } else {
      elTxt.textContent = "Conectando...";
    }

    if (d.modo === "suscriptor") {
      elModo.textContent = d.usuario ? "Suscriptor (" + d.usuario + ")" : "Suscriptor";
      btnLimpiar.classList.remove("hidden");
      if (primeraCarga && d.usuario) elUsuario.value = d.usuario;
    } else {
      elModo.textContent = "Acceso libre";
      btnLimpiar.classList.add("hidden");
    }

    if (d.autostart?.disponible) {
      rowAutostart.classList.remove("hidden");
      if (primeraCarga) chkAutostart.checked = Boolean(d.autostart.activo);
    }
    primeraCarga = false;
  } catch {
    elPill.className = "pill err";
    elTxt.textContent = "Detenido";
  }
}

document.getElementById("btn-copiar").addEventListener("click", async () => {
  const btn = document.getElementById("btn-copiar");
  try {
    await navigator.clipboard.writeText(elUrl.value);
    btn.textContent = "✓ Copiada";
    setTimeout(() => { btn.textContent = "Copiar URL"; }, 1800);
  } catch {
    elUrl.select();
    document.execCommand("copy");
    btn.textContent = "✓ Copiada";
    setTimeout(() => { btn.textContent = "Copiar URL"; }, 1800);
  }
});

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    for (const t of document.querySelectorAll(".tab")) t.classList.remove("active");
    tab.classList.add("active");
    const destino = tab.dataset.tab;
    for (const id of ["chatgpt", "gemini", "claude"]) {
      document.getElementById("pasos-" + id).classList.toggle("hidden", id !== destino);
    }
  });
}

document.getElementById("form-cred").addEventListener("submit", async (e) => {
  e.preventDefault();
  msgCred.className = "status-msg";
  msgCred.textContent = "Guardando...";
  const r = await fetch("/ui/api/credenciales", {
    method: "POST",
    headers: headersPost,
    body: JSON.stringify({ usuario: elUsuario.value.trim(), clave: elClave.value }),
  });
  const d = await r.json();
  if (r.ok && d.ok) {
    elClave.value = "";
    msgCred.className = "status-msg ok";
    msgCred.textContent = d.modo === "suscriptor"
      ? "Cuenta guardada en tu PC. Usa «Probar conexión SPIJ» para verificarla."
      : "Configurado en acceso libre.";
    refrescarEstado();
  } else {
    msgCred.className = "status-msg err";
    msgCred.textContent = d.error || "No se pudo guardar.";
  }
});

btnLimpiar.addEventListener("click", async () => {
  const r = await fetch("/ui/api/credenciales", {
    method: "POST",
    headers: headersPost,
    body: JSON.stringify({ usuario: "", clave: "" }),
  });
  if (r.ok) {
    elUsuario.value = "";
    elClave.value = "";
    msgCred.className = "status-msg ok";
    msgCred.textContent = "Cuenta eliminada. Ahora usas acceso libre.";
    refrescarEstado();
  }
});

chkAutostart.addEventListener("change", async () => {
  const r = await fetch("/ui/api/autostart", {
    method: "POST",
    headers: headersPost,
    body: JSON.stringify({ activo: chkAutostart.checked }),
  });
  const d = await r.json();
  if (!r.ok || !d.ok) {
    chkAutostart.checked = !chkAutostart.checked;
    msgDiag.className = "status-msg err";
    msgDiag.textContent = d.error || "No se pudo cambiar el inicio automático.";
  } else {
    msgDiag.className = "status-msg ok";
    msgDiag.textContent = d.activo
      ? "SPIJ MCP se abrirá automáticamente al encender Windows."
      : "Inicio automático desactivado.";
  }
});

document.getElementById("btn-diag").addEventListener("click", async () => {
  msgDiag.className = "status-msg";
  msgDiag.textContent = "Consultando el SPIJ...";
  try {
    const r = await fetch("/ui/api/diagnostico", { method: "POST", headers: headersPost });
    const d = await r.json();
    if (r.ok && d.ok) {
      const normas = Number(d.diagnostico?.normas || 0).toLocaleString("es-PE");
      const ms = d.diagnostico?.latencia_ms ? " · " + (d.diagnostico.latencia_ms / 1000).toFixed(1) + " s" : "";
      msgDiag.className = "status-msg ok";
      msgDiag.textContent = "✓ SPIJ activo (" + d.diagnostico.modo + ") · " + normas + " normas" + ms;
    } else {
      msgDiag.className = "status-msg err";
      msgDiag.textContent = d.error || "No se pudo conectar al SPIJ.";
    }
  } catch {
    msgDiag.className = "status-msg err";
    msgDiag.textContent = "No se pudo ejecutar el diagnóstico.";
  }
});

document.getElementById("btn-descargas").addEventListener("click", async () => {
  await fetch("/ui/api/abrir-descargas", { method: "POST", headers: headersPost });
});

document.getElementById("btn-salir").addEventListener("click", async () => {
  msgDiag.className = "status-msg";
  msgDiag.textContent = "Deteniendo SPIJ MCP...";
  try {
    await fetch("/ui/api/salir", { method: "POST", headers: headersPost });
  } catch {}
  window.close();
});

refrescarEstado();
setInterval(refrescarEstado, 2500);
</script>
</body>
</html>`;
}

/**
 * Crea el manejador de rutas `/ui` y `/ui/api/*` para acoplarlo al servidor HTTP
 * local. Devuelve `true` si la petición fue atendida, o `false` para seguir
 * hacia `/mcp` y `/health`.
 */
export function crearManejadorUi(opciones) {
  const {
    cliente,
    obtenerEstadoRelay,
    rutaConfig,
    alSalir,
    tieneBandeja = Boolean(process.env.SPIJ_MCP_EXE),
  } = opciones;

  const tokenUi = crypto.randomBytes(16).toString("hex");
  const html = renderHtml(tokenUi, tieneBandeja);

  const tokenValido = (req) => {
    const recibido = String(req.headers["x-spij-token"] || "");
    if (recibido.length !== tokenUi.length) return false;
    return crypto.timingSafeEqual(Buffer.from(recibido), Buffer.from(tokenUi));
  };

  return async function manejarUi(req, res, url) {
    const ruta = url.pathname;
    if (ruta !== "/ui" && !ruta.startsWith("/ui/")) return false;

    if (!esHostLocal(req.headers.host)) {
      responderJson(res, 403, { error: "El panel local solo está disponible desde esta computadora." });
      return true;
    }

    if ((ruta === "/ui" || ruta === "/ui/") && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(html);
      return true;
    }

    if (ruta === "/ui/icon.png" && req.method === "GET") {
      try {
        const datos = await fsp.readFile(RUTA_ICONO);
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" });
        res.end(datos);
      } catch {
        res.writeHead(404);
        res.end();
      }
      return true;
    }

    if (ruta === "/ui/api/estado" && req.method === "GET") {
      const relay = obtenerEstadoRelay();
      const autostart = await obtenerInicioWindows();
      responderJson(res, 200, {
        ok: true,
        version: VERSION,
        modo: cliente.modo,
        usuario: cliente.modo === "suscriptor" ? cliente.usuario : "",
        urlMcp: relay.urlMcp || "",
        relayEstado: relay.estado || "conectando",
        relayDetalle: relay.detalle || "",
        autostart,
      });
      return true;
    }

    if (req.method === "POST" && ruta.startsWith("/ui/api/")) {
      if (!tokenValido(req)) {
        responderJson(res, 403, { error: "Token local inválido." });
        return true;
      }

      if (ruta === "/ui/api/credenciales") {
        try {
          const cuerpo = await leerJsonCuerpo(req);
          const usuario = String(cuerpo?.usuario || "").trim();
          const clave = String(cuerpo?.clave || "");
          if ((usuario && !clave) || (!usuario && clave)) {
            responderJson(res, 400, { error: "Escribe usuario y contraseña, o deja ambos vacíos para acceso libre." });
            return true;
          }
          await guardarCredenciales({ usuario, clave }, rutaConfig);
          cliente.configurarCredenciales(usuario, clave);
          responderJson(res, 200, { ok: true, modo: cliente.modo });
        } catch (error) {
          responderJson(res, 400, { error: error.message || "Error al guardar credenciales." });
        }
        return true;
      }

      if (ruta === "/ui/api/diagnostico") {
        try {
          const diagnostico = await cliente.diagnostico();
          responderJson(res, 200, { ok: true, diagnostico });
        } catch (error) {
          responderJson(res, 502, { ok: false, error: error.message || "Error al consultar el SPIJ." });
        }
        return true;
      }

      if (ruta === "/ui/api/autostart") {
        try {
          const cuerpo = await leerJsonCuerpo(req);
          const resultado = await configurarInicioWindows(Boolean(cuerpo?.activo));
          responderJson(res, 200, { ok: true, ...resultado });
        } catch (error) {
          responderJson(res, 500, { ok: false, error: error.message || "No se pudo actualizar el inicio automático." });
        }
        return true;
      }

      if (ruta === "/ui/api/abrir-descargas") {
        try {
          abrirCarpetaLocal(carpetaDescargasSpij());
          responderJson(res, 200, { ok: true });
        } catch (error) {
          responderJson(res, 500, { ok: false, error: error.message });
        }
        return true;
      }

      if (ruta === "/ui/api/salir") {
        responderJson(res, 200, { ok: true });
        if (typeof alSalir === "function") {
          setTimeout(() => alSalir(), 120);
        }
        return true;
      }
    }

    responderJson(res, 404, { error: "Ruta UI no encontrada." });
    return true;
  };
}
