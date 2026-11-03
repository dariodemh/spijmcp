/**
 * Comprobación de actualizaciones contra las releases de GitHub.
 *
 * El MCP consulta la API pública de GitHub (sin autenticación), compara la
 * versión instalada con la última publicada y devuelve el enlace de descarga
 * del `.mcpb`. El resultado se cachea unas horas para no gastar el límite
 * de peticiones de GitHub (60/hora por IP sin token).
 */

import { REPO, VERSION, esRepoConfigurado } from "./config.js";

const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map(); // repo -> { expira, resultado }

/** Quita "v" inicial y espacios. */
function limpiar(version) {
  return String(version || "").trim().replace(/^v/i, "");
}

/**
 * Compara dos versiones semver simples.
 * @returns {number} -1 si a < b, 0 si son iguales, 1 si a > b.
 */
export function compararVersiones(a, b) {
  const [nucleoA, preA] = limpiar(a).split("-");
  const [nucleoB, preB] = limpiar(b).split("-");

  const partesA = nucleoA.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const partesB = nucleoB.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const largo = Math.max(partesA.length, partesB.length);

  for (let i = 0; i < largo; i += 1) {
    const x = partesA[i] || 0;
    const y = partesB[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }

  // Igual núcleo: una versión final es mayor que una previa (1.0.0 > 1.0.0-rc.1).
  if (preA && !preB) return -1;
  if (!preA && preB) return 1;
  if (preA && preB) {
    return preA === preB ? 0 : preA > preB ? 1 : -1;
  }
  return 0;
}

async function pedirJson(url, fetchImpl, timeoutMs) {
  const respuesta = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "spij-mcp",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const texto = await respuesta.text();
  let datos = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = null;
  }
  return { status: respuesta.status, datos, texto, headers: respuesta.headers };
}

/**
 * Comprueba si hay una versión más reciente publicada en GitHub.
 *
 * @param {object} [opciones]
 * @param {string} [opciones.repo]      Repositorio "usuario/repo".
 * @param {string} [opciones.actual]    Versión instalada.
 * @param {boolean} [opciones.forzar]   Ignorar la caché.
 * @param {number} [opciones.timeoutMs]
 * @param {Function} [opciones.fetchImpl]
 */
export async function comprobarActualizacion(opciones = {}) {
  const repo = opciones.repo === undefined ? REPO : opciones.repo;
  const actual = opciones.actual || VERSION;
  const timeoutMs = opciones.timeoutMs ?? 6000;
  const fetchImpl = opciones.fetchImpl || fetch;

  if (!esRepoConfigurado(repo)) {
    return {
      configurado: false,
      actual,
      mensaje:
        "La comprobación de actualizaciones no está configurada. Define SPIJ_MCP_REPO (formato 'usuario/repo') o edita REPO_POR_DEFECTO en src/config.js.",
    };
  }

  const clave = `${repo}@${actual}`;
  const guardado = cache.get(clave);
  if (!opciones.forzar && guardado && guardado.expira > Date.now()) {
    return guardado.resultado;
  }

  const base = `https://api.github.com/repos/${repo}`;
  let ultima = null;
  let urlRelease = null;
  let urlDescarga = null;
  let publicado = null;
  let notas = null;
  let fuente = "release";
  let error = null;

  try {
    let respuesta = await pedirJson(`${base}/releases/latest`, fetchImpl, timeoutMs);

    if (respuesta.status === 404) {
      // Repos sin releases: se usan las etiquetas.
      fuente = "tag";
      respuesta = await pedirJson(`${base}/tags?per_page=1`, fetchImpl, timeoutMs);
      if (respuesta.status === 404) {
        error = `No se encontró el repositorio ${repo}. Revisa que exista, que sea público y que SPIJ_MCP_REPO esté bien escrito.`;
      } else if (respuesta.status === 200 && Array.isArray(respuesta.datos) && respuesta.datos[0]) {
        ultima = respuesta.datos[0].name;
        urlRelease = `${base.replace("api.github.com/repos", "github.com")}/releases`;
      } else {
        error = "El repositorio no tiene releases ni etiquetas.";
      }
    } else if (respuesta.status === 403) {
      const reinicio = respuesta.headers?.get?.("x-ratelimit-reset");
      const cuando = reinicio
        ? new Date(Number(reinicio) * 1000).toLocaleString("es-PE")
        : "más tarde";
      error = `GitHub limitó las peticiones (se reinicia ${cuando}). Inténtalo de nuevo más tarde.`;
    } else if (respuesta.status === 401) {
      error = "El repositorio no es público; la comprobación de actualizaciones requiere un repo público.";
    } else if (respuesta.status !== 200 || !respuesta.datos) {
      error = `GitHub respondió HTTP ${respuesta.status}.`;
    } else {
      const release = respuesta.datos;
      ultima = release.tag_name || release.name;
      urlRelease = release.html_url || null;
      publicado = release.published_at || null;
      notas = release.body ? String(release.body).slice(0, 2000) : null;
      const asset = (release.assets || []).find((a) =>
        String(a.name || "").endsWith(".mcpb"),
      );
      urlDescarga = asset?.browser_download_url || null;
    }
  } catch (e) {
    error = `No se pudo consultar GitHub: ${e.message}`;
  }

  if (!ultima) {
    return { configurado: true, actual, error };
  }

  const resultado = {
    configurado: true,
    actual,
    ultima,
    hay_actualizacion: compararVersiones(ultima, actual) > 0,
    url_release: urlRelease,
    url_descarga: urlDescarga,
    publicado,
    notas,
    fuente,
    comprobado: new Date().toISOString(),
  };

  cache.set(clave, { expira: Date.now() + CACHE_MS, resultado });
  return resultado;
}
