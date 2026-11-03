/**
 * Cliente no oficial de la API interna del SPIJ (spij.minjus.gob.pe).
 *
 * El front-end Angular del SPIJ habla con dos servicios:
 *
 *   - spij-ext-back  (metadatos, login, detalle de documentos)
 *   - spij-ext-solr  (búsqueda sobre el índice Solr)
 *
 * El sitio ofrece un botón "ACCESO LIBRE" que, por dentro, usa una cuenta
 * invitada pública cuyas credenciales viajan en el propio bundle del
 * front-end. Este cliente reproduce ese mismo flujo de invitado cuando no
 * se configuran credenciales, y usa la cuenta del usuario cuando sí se
 * configuran (necesario para ver el texto que el SPIJ restringe a suscriptores).
 *
 * No es una API documentada ni estable: puede cambiar sin aviso.
 */

const BACK_DEFAULT = "https://spijwsii.minjus.gob.pe/spij-ext-back";
const SOLR_DEFAULT = "https://spijwsii.minjus.gob.pe/spij-ext-solr";

/** `process` no existe en runtimes como Cloudflare Workers. */
const ENV = typeof process !== "undefined" && process.env ? process.env : {};

/** Cuenta invitada que usa el propio front-end en "ACCESO LIBRE". */
const INVITADO = { usuario: "spijext", clave: "password" };

const APP_URL = "https://spij.minjus.gob.pe/spij-ext-web/#/detallenorma";

const USER_AGENT =
  "spij-mcp/0.2 (cliente de investigacion; contacto: responsable del despliegue)";

const PAYWALL_MARK = "accesible para suscriptores";

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const ENTIDADES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü", ordm: "º", ordf: "ª", deg: "°",
  iquest: "¿", iexcl: "¡", laquo: "«", raquo: "»", ldquo: "“", rdquo: "”",
  lsquo: "‘", rsquo: "’", ndash: "–", mdash: "—", hellip: "…", sect: "§", middot: "·",
};

function decodificarEntidades(texto) {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entidad, nombre) => {
    if (nombre[0] === "#") {
      const codigo = nombre[1].toLowerCase() === "x" ? parseInt(nombre.slice(2), 16) : Number(nombre.slice(1));
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : entidad;
    }
    return ENTIDADES[nombre] ?? entidad;
  });
}

/** Enlaces a PDFs alojados en el SPIJ (p. ej. normas que solo se publican como PDF). */
export function pdfsDe(html) {
  const pdfs = new Map();
  for (const m of String(html || "").matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+\.pdf)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = m[1].replace(/^http:\/\//i, "https://");
    if (/^https:\/\/spij\.minjus\.gob\.pe\//i.test(url) && !pdfs.has(url)) {
      pdfs.set(url, { texto: htmlATexto(m[2]).replace(/^Enlace Web:\s*/i, ""), url });
    }
  }
  return [...pdfs.values()];
}

export function htmlATexto(html) {
  if (html === null || html === undefined) return "";
  return decodificarEntidades(
    String(html)
      // Conserva los enlaces: los PDF como URL y las referencias a otras normas como su id del SPIJ.
      .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, texto) => {
        const id = href.match(/detallenorma\/([A-Za-z0-9]+)/)?.[1];
        const destino = id || (/\.pdf$/i.test(href) ? href.replace(/^\//, "https://spij.minjus.gob.pe/") : "");
        return destino ? `${texto} [${destino}]` : texto;
      })
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      .replace(/<\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function recortar(texto, max, desde = 0) {
  if (!max || texto.length - desde <= max) return texto.slice(desde);
  const resto = texto.length - desde - max;
  return `${texto.slice(desde, desde + max).trimEnd()}\n[... recortado: ${resto} caracteres más; continúa con desde=${desde + max}]`;
}

function nombreSector(sector) {
  if (!sector) return null;
  if (typeof sector === "string") return sector.trim() || null;
  if (typeof sector === "object") {
    return sector.nombre || sector.name || null;
  }
  return null;
}

/** Extrae `exp` (epoch en segundos) de un JWT, sin validar la firma. */
function expiracionJwt(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json =
      typeof atob === "function"
        ? atob(base64)
        : Buffer.from(base64, "base64").toString("utf8");
    const payload = JSON.parse(json);
    return Number(payload.exp) || 0;
  } catch {
    return 0;
  }
}

function listaDe(valor) {
  if (valor === undefined || valor === null || valor === "") return [];
  return Array.isArray(valor) ? valor : [valor];
}

export class SpijError extends Error {
  constructor(mensaje, extra = {}) {
    super(mensaje);
    this.name = "SpijError";
    this.status = extra.status ?? null;
    this.ruta = extra.ruta ?? null;
    this.cuerpo = extra.cuerpo ?? null;
    this.reintentable = Boolean(extra.reintentable);
  }
}

/* ------------------------------------------------------------------ */
/* Cliente                                                             */
/* ------------------------------------------------------------------ */

export class SpijClient {
  /**
   * @param {object} [opciones]
   * @param {string} [opciones.usuario]  Usuario suscriptor del SPIJ.
   * @param {string} [opciones.clave]    Contraseña del suscriptor.
   * @param {number} [opciones.intervaloMinimoMs] Pausa mínima entre llamadas.
   * @param {number} [opciones.timeoutMs] Timeout por petición.
   * @param {number} [opciones.reintentos] Reintentos ante fallos de red.
   * @param {boolean} [opciones.silencio] No escribir diagnósticos en stderr.
   */
  constructor(opciones = {}) {
    this.baseBack = (opciones.baseBack || ENV.SPIJ_BACK_URL || BACK_DEFAULT).replace(/\/+$/, "");
    this.baseSolr = (opciones.baseSolr || ENV.SPIJ_SOLR_URL || SOLR_DEFAULT).replace(/\/+$/, "");
    this.usuario = opciones.usuario || ENV.SPIJ_USUARIO || "";
    this.clave = opciones.clave || ENV.SPIJ_CLAVE || "";
    this.intervaloMinimoMs = opciones.intervaloMinimoMs ?? 300;
    this.timeoutMs = opciones.timeoutMs ?? 30000;
    this.reintentos = opciones.reintentos ?? 2;
    this.silencio = Boolean(opciones.silencio);

    this._tokens = { back: null, solr: null };
    this._ultimaLlamada = 0;
    this._catalogos = null;
    this._suscriptorVerificado = false;
    this._modo = this.usuario && this.clave ? "suscriptor" : "libre";
  }

  get modo() {
    return this._modo;
  }

  _log(...args) {
    if (!this.silencio) console.error("[spij]", ...args);
  }

  /** Espera lo necesario para no martillar el servicio. */
  async _esperarTurno() {
    const ahora = Date.now();
    const espera = this.intervaloMinimoMs - (ahora - this._ultimaLlamada);
    if (espera > 0) await dormir(espera);
    this._ultimaLlamada = Date.now();
  }

  async _http(url, opciones, intento = 0) {
    await this._esperarTurno();
    let respuesta;
    try {
      respuesta = await fetch(url, {
        ...opciones,
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
          ...(opciones.headers || {}),
        },
      });
    } catch (error) {
      if (intento < this.reintentos) {
        await dormir(700 * (intento + 1));
        return this._http(url, opciones, intento + 1);
      }
      throw new SpijError(
        `No se pudo conectar con el SPIJ (${url}): ${error.message}`,
        { reintentable: true },
      );
    }

    const texto = await respuesta.text();

    if (respuesta.status === 429 && intento < this.reintentos) {
      const retryAfter = Number(respuesta.headers.get("retry-after")) || 2 * (intento + 1);
      await dormir(retryAfter * 1000);
      return this._http(url, opciones, intento + 1);
    }

    if (respuesta.status >= 500 && intento < this.reintentos && !texto.includes("No se ha podido ejecutar la consulta")) {
      await dormir(700 * (intento + 1));
      return this._http(url, opciones, intento + 1);
    }

    return { status: respuesta.status, texto };
  }

  /* ------------------------------ sesión ------------------------------ */

  async _token(tipo) {
    const cache = this._tokens[tipo];
    if (cache && cache.expiraEn - Date.now() > 5 * 60 * 1000) return cache.valor;
    const nuevo = await this._autenticar(tipo);
    this._tokens[tipo] = nuevo;
    return nuevo.valor;
  }

  /** Reproduce el flujo de autenticación del front-end del SPIJ. */
  async _autenticar(tipo) {
    let nivel = "0";

    if (this._modo === "suscriptor") {
      if (!this._suscriptorVerificado) {
        const login = await this._http(`${this.baseBack}/api/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            usuario: this.usuario,
            password: this.clave,
            captcha_response: true,
          }),
        });
        if (login.status !== 200) {
          this._modo = "libre";
          this._log("No se pudo iniciar sesión como suscriptor; se usará el acceso libre.");
        } else {
          this._suscriptorVerificado = true;
        }
      }
      if (this._suscriptorVerificado) nivel = "1";
    }

    const url =
      tipo === "solr"
        ? `${this.baseSolr}/authenticate`
        : `${this.baseBack}/authenticate`;
    const cuerpo = tipo === "solr"
      ? { usuario: INVITADO.usuario, clave: INVITADO.clave }
      : { usuario: INVITADO.usuario, clave: INVITADO.clave, tipo: nivel };

    const { status, texto } = await this._http(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });

    if (status !== 200) {
      throw new SpijError(`El SPIJ rechazó la autenticación (HTTP ${status}).`, {
        status,
        ruta: url,
        cuerpo: texto.slice(0, 400),
      });
    }

    let datos;
    try {
      datos = JSON.parse(texto);
    } catch {
      throw new SpijError("Respuesta de autenticación ilegible del SPIJ.", {
        status,
        cuerpo: texto.slice(0, 400),
      });
    }

    const valor = datos.value || datos.token;
    if (!valor) {
      throw new SpijError("El SPIJ no devolvió un token de sesión.", {
        status,
        cuerpo: texto.slice(0, 400),
      });
    }

    const exp = expiracionJwt(valor);
    return {
      valor,
      expiraEn: exp ? exp * 1000 : Date.now() + 20 * 60 * 1000,
    };
  }

  _invalidateTokens() {
    this._tokens = { back: null, solr: null };
  }

  /* ----------------------------- búsqueda ----------------------------- */

  _cuerpoBusqueda(opciones = {}) {
    const tipo = ["JR", "jurisprudencia", "j"].includes(opciones.tipo) ||
      opciones.tipoNorma === "JR"
      ? "JR"
      : "NR";

    const desde = Number(opciones.desde ?? 0);
    const hasta = Number(opciones.hasta ?? desde + 10);

    const filtros = {
      buscarHistorico: Boolean(opciones.historico),
      busquedaSugerida: false,
      numeroDispositivoLegal: opciones.numero || "",
      dispositivoLegal: listaDe(opciones.tipoDispositivo),
      tomo: { id: "", nombre: "" },
      materia: opciones.materia
        ? { id: String(opciones.materia), nombre: String(opciones.materia) }
        : { id: "", nombre: "" },
      agrupacion: listaDe(opciones.agrupacion),
      sector: listaDe(opciones.sector),
      subSector: { id: "", nombre: "" },
      orden: String(opciones.orden || "1"),
    };

    const cuerpo = {
      filtros,
      facetsSeleccionadas: {
        fechaPublicacionGap: { numero: 10, unidad: "YEAR" },
      },
      tipoNorma: tipo,
      textoBusqueda: opciones.texto ?? "",
      textoSumilla: opciones.sumilla ?? null,
      desde,
      hasta,
    };

    if (opciones.fechaDesde) cuerpo.fechaInicio = opciones.fechaDesde;
    if (opciones.fechaHasta) cuerpo.fechaFin = opciones.fechaHasta;

    return cuerpo;
  }

  async _buscar(opciones) {
    const cuerpo = this._cuerpoBusqueda(opciones);
    let token = await this._token("solr");

    let respuesta = await this._http(`${this.baseSolr}/api/buscar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(cuerpo),
    });

    if (respuesta.status === 401 || respuesta.status === 403) {
      this._tokens.solr = null;
      token = await this._token("solr");
      respuesta = await this._http(`${this.baseSolr}/api/buscar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(cuerpo),
      });
    }

    if (respuesta.status !== 200) {
      let mensaje = respuesta.status === 500
        ? "El SPIJ rechazó los filtros de búsqueda (HTTP 500). Prueba con menos filtros o revisa los identificadores."
        : `La búsqueda falló (HTTP ${respuesta.status}).`;
      throw new SpijError(mensaje, {
        status: respuesta.status,
        ruta: `${this.baseSolr}/api/buscar`,
        cuerpo: respuesta.texto.slice(0, 500),
        reintentable: respuesta.status >= 500,
      });
    }

    return JSON.parse(respuesta.texto);
  }

  /** Busca normas (legislación). */
  async buscarNormas(opciones = {}) {
    return this._formatearBusqueda(await this._buscar({ ...opciones, tipo: "NR" }), opciones);
  }

  /** Busca jurisprudencia (casaciones, expedientes, resoluciones, etc.). */
  async buscarJurisprudencia(opciones = {}) {
    return this._formatearBusqueda(await this._buscar({ ...opciones, tipo: "JR" }), opciones);
  }

  _formatearBusqueda(bruto, opciones) {
    const maxSumilla = opciones.maxSumilla ?? 700;
    const resultados = (bruto.resultados || []).map((r) => ({
      id: r.id,
      codigo: r.codigoNorma || null,
      fecha: r.fechaPublicacion || null,
      tipo: r.dispositivoLegal || null,
      sector: nombreSector(r.sector),
      ruta: r.ruta || null,
      sumilla: r.sumilla ? recortar(htmlATexto(r.sumilla), maxSumilla) : null,
      url: r.id ? `${APP_URL}/${r.id}` : null,
    }));

    const desde = Number(bruto.desde ?? opciones.desde ?? 0);
    const hasta = Number(bruto.hasta ?? opciones.hasta ?? 0);

    return {
      total: Number(bruto.totalEncontrados ?? resultados.length),
      desde,
      hasta,
      por_pagina: Math.max(0, hasta - desde),
      resultados,
      facets: this._facetas(bruto.facets),
    };
  }

  _facetas(facets) {
    if (!facets) return null;
    const limpio = {};
    for (const [clave, valores] of Object.entries(facets)) {
      if (!Array.isArray(valores)) continue;
      limpio[clave] = valores
        .filter(
          (v) =>
            v &&
            Number(v.total) > 0 &&
            String(v.nombre ?? "").trim() !== "",
        )
        .sort((a, b) => Number(b.total) - Number(a.total))
        .slice(0, 12)
        .map((v) => ({ valor: String(v.nombre ?? "").trim(), total: Number(v.total) }));
    }
    return limpio;
  }

  /* ------------------------------ detalle ----------------------------- */

  async _detalle(id) {
    const limpio = String(id || "").trim();
    if (!/^[A-Za-z0-9]{3,24}$/.test(limpio)) {
      throw new SpijError("Identificador de documento inválido. Debe lucir como 'H1453514'.");
    }
    const d = await this._getBack(`/api/detallenorma/${encodeURIComponent(limpio)}`, {
      error: `No se pudo obtener el documento ${limpio}`,
    });
    d.id = d.id || limpio;
    return d;
  }

  async obtenerDocumento(id, opciones = {}) {
    const d = await this._detalle(id);
    const textoBruto = htmlATexto(d.textoCompleto);
    const esPaywall = textoBruto.toLowerCase().includes(PAYWALL_MARK);
    const maxChars = opciones.maxChars ?? 12000;
    const desde = Math.min(opciones.desde ?? 0, textoBruto.length);

    return {
      id: d.id,
      codigo: d.codigoNorma || null,
      fecha: d.fechaPublicacion || null,
      tipo: d.dispositivoLegal || null,
      sector: nombreSector(d.sector),
      ruta: d.ruta || null,
      titulo: d.titulo && !/campo no disponible/i.test(d.titulo) ? htmlATexto(d.titulo) : null,
      sumilla: d.sumilla ? htmlATexto(d.sumilla) : null,
      texto: esPaywall ? null : recortar(textoBruto, maxChars, desde),
      texto_disponible: !esPaywall,
      total_caracteres: esPaywall ? null : textoBruto.length,
      pdfs: pdfsDe(d.textoCompleto),
      aviso: esPaywall
        ? "El texto completo está reservado a suscriptores del SPIJ. Configura SPIJ_USUARIO y SPIJ_CLAVE para consultarlo con tu cuenta."
        : null,
      url: `${APP_URL}/${d.id}`,
    };
  }

  /**
   * Prepara los archivos de un documento como los descarga el SPIJ.
   * "word" usa el mismo servicio que el botón Descargar (HTML con formato de Word, .doc);
   * "pdf" descarga los PDF originales que el SPIJ enlaza en el documento.
   * @returns {Promise<Array<{nombre: string, datos: Uint8Array}>>}
   */
  async exportar(id, formato) {
    const d = await this._detalle(id);
    // procesarword no aplica el control de suscriptores; se respeta el que sí aplica el detalle.
    if (htmlATexto(d.textoCompleto).toLowerCase().includes(PAYWALL_MARK)) {
      throw new SpijError(
        "El texto completo de este documento está reservado a suscriptores del SPIJ; no se puede exportar con el acceso libre.",
      );
    }

    if (formato === "pdf") {
      const pdfs = pdfsDe(d.textoCompleto);
      if (pdfs.length === 0) {
        throw new SpijError(
          "Este documento no tiene un PDF original en el SPIJ. Expórtalo en formato word.",
        );
      }
      const archivos = [];
      for (const { url } of pdfs) {
        await this._esperarTurno();
        const respuesta = await fetch(url, {
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: { "User-Agent": USER_AGENT },
        });
        if (!respuesta.ok) {
          throw new SpijError(`No se pudo descargar ${url} (HTTP ${respuesta.status}).`);
        }
        archivos.push({
          nombre: decodeURIComponent(url.split("/").pop()),
          datos: new Uint8Array(await respuesta.arrayBuffer()),
        });
      }
      return archivos;
    }

    const html = await this._getBack(`/api/procesarword/${encodeURIComponent(d.id)}`, {
      texto: true,
      error: `No se pudo exportar el documento ${d.id}`,
    });
    // Mismo envoltorio que usa el front-end del SPIJ para que Word abra el HTML.
    const documento =
      "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' " +
      "xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'>" +
      `<title>${d.id}</title></head><body>${html}</body></html>`;
    return [{ nombre: `${d.id}.doc`, datos: new TextEncoder().encode(documento) }];
  }

  /* ----------------------------- catálogos ---------------------------- */

  async _getBack(ruta, opciones = {}) {
    let token = await this._token("back");
    let respuesta = await this._http(`${this.baseBack}${ruta}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (respuesta.status === 401 || respuesta.status === 403) {
      this._tokens.back = null;
      token = await this._token("back");
      respuesta = await this._http(`${this.baseBack}${ruta}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    if (respuesta.status !== 200) {
      const error = opciones.error || `No se pudo leer el catálogo ${ruta}`;
      throw new SpijError(`${error} (HTTP ${respuesta.status}).`, {
        status: respuesta.status,
        cuerpo: respuesta.texto.slice(0, 300),
      });
    }
    return opciones.texto ? respuesta.texto : JSON.parse(respuesta.texto);
  }

  async catalogos() {
    if (this._catalogos) return this._catalogos;

    const [maestrosBruto, agrupamientoBruto, sectorBruto] = await Promise.all([
      this._getBack("/api/maestros"),
      this._getBack("/api/agrupamiento"),
      this._getBack("/api/sector"),
    ]);

    const maestros = Array.isArray(maestrosBruto) ? maestrosBruto[0] || {} : maestrosBruto;
    const agrupamiento = Array.isArray(agrupamientoBruto)
      ? agrupamientoBruto[0]?.agrupamientoNormas || []
      : [];
    const sector = Array.isArray(sectorBruto)
      ? sectorBruto[0]?.sectores || []
      : [];

    const unicos = (items) => {
      const vistos = new Set();
      return items.filter((x) => {
        const clave = `${x.id}|${x.grupo ?? ""}`;
        if (vistos.has(clave)) return false;
        vistos.add(clave);
        return true;
      });
    };

    this._catalogos = {
      agrupaciones: (maestros.agrupacion || []).filter((x) => x.id !== "NINGUNO"),
      tipos_dispositivo_legal: (maestros.dispositivolegal || []).filter((x) => x.id !== "NINGUNO"),
      sectores: unicos(sector.filter((x) => x.id && x.id !== "NINGUNO")),
      materias: maestros.materia || {},
      tomos: (maestros.tomo || []).filter((x) => x.id !== "NINGUNO"),
      agrupamientos_normas: agrupamiento.filter((x) => x.id !== "NINGUNO"),
    };

    return this._catalogos;
  }

  /** Diagnóstico rápido: comprueba que la sesión y el índice responden. */
  async diagnostico() {
    const inicio = Date.now();
    const normas = await this.buscarNormas({ texto: "", desde: 0, hasta: 1 });
    const juris = await this.buscarJurisprudencia({ texto: "", desde: 0, hasta: 1 });
    return {
      modo: this.modo,
      autenticacion: this._tokens.solr ? "ok" : "renovada",
      normas_en_indice: normas.total,
      jurisprudencia_en_indice: juris.total,
      latencia_ms: Date.now() - inicio,
    };
  }
}

export const constantes = {
  BACK_DEFAULT,
  SOLR_DEFAULT,
  INVITADO,
  APP_URL,
};
