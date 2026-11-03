/**
 * Definición de las herramientas MCP que exponen el SPIJ.
 */

import { z } from "zod";
import { SpijError } from "./spij.js";
import { comprobarActualizacion } from "./updates.js";
import { VERSION, esRepoConfigurado } from "./config.js";

const textoSalida = (datos) => ({
  content: [{ type: "text", text: JSON.stringify(datos, null, 2) }],
});

const errorSalida = (error) => ({
  isError: true,
  content: [
    {
      type: "text",
      text:
        error instanceof SpijError
          ? `${error.message}${error.cuerpo ? `\n\nRespuesta del SPIJ: ${error.cuerpo}` : ""}`
          : `Error inesperado: ${error.message}`,
    },
  ],
});

const paginacion = {
  pagina: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe("Página de resultados, empezando en 1."),
  por_pagina: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("Resultados por página (1 a 20)."),
};

const filtrosComunes = {
  texto: z
    .string()
    .optional()
    .describe(
      "Palabras clave (2 a 4 funcionan mejor), sin comillas: el SPIJ no devuelve nada con frases entre comillas ni con consultas largas. No pongas aquí el número de la norma: va en 'numero'. Vacío = listar sin filtro de texto.",
    ),
  numero: z
    .string()
    .optional()
    .describe(
      "Número del dispositivo legal, por ejemplo '111-2024-PCM', '27444' o '04143-2024-PA/TC'. Es la forma más precisa de buscar: úsalo siempre que conozcas el número.",
    ),
  fecha_desde: z
    .string()
    .optional()
    .describe("Fecha inicial de publicación en formato AAAA-MM-DD."),
  fecha_hasta: z
    .string()
    .optional()
    .describe("Fecha final de publicación en formato AAAA-MM-DD."),
  sector: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      "Sector o entidad emisora (puede ser un id o una lista de ids). Ejemplos: 'MINISTERIO DE TRANSPORTES Y COMUNICACIONES', 'JNE'. Usa catalogo_spij para ver los valores.",
    ),
  materia: z
    .string()
    .optional()
    .describe("Materia o especialidad (id exacto del catálogo). Usa catalogo_spij para ver los valores."),
  tipo_dispositivo: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      "Tipo de documento: 'LEY', 'DECRETO SUPREMO', 'RESOLUCION MINISTERIAL', 'CASACION', 'EXPEDIENTE', etc. Usa catalogo_spij para ver los valores.",
    ),
  agrupacion: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      "Agrupación temática del SPIJ, por ejemplo 'LEGISLACIÓN DE CARACTER GENERAL' o 'JURISPRUDENCIA JUDICIAL, ADMINISTRATIVA, SUPRANACIONAL Y CONSTITUCIONAL'.",
    ),
  orden: z
    .string()
    .default("1")
    .describe("Criterio de ordenamiento interno del SPIJ (por defecto '1', relevancia)."),
};

function rangoPagina(pagina, porPagina) {
  const desde = (pagina - 1) * porPagina;
  return { desde, hasta: desde + porPagina };
}

/**
 * Registra todas las herramientas en un servidor MCP.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {import("./spij.js").SpijClient} cliente
 */
export function registrarHerramientas(server, cliente, opciones = {}) {
  const repo = opciones.repo || "";
  server.registerTool(
    "buscar_normas",
    {
      title: "Buscar normas en el SPIJ",
      description:
        "Busca legislación peruana (leyes, decretos, resoluciones, ordenanzas) en el índice del SPIJ. Devuelve metadatos, sumilla, total de coincidencias y facetas para refinar la búsqueda. Muchas normas recientes incluyen el texto completo en el acceso libre; el campo texto_disponible de obtener_documento lo indica.",
      inputSchema: {
        ...filtrosComunes,
        ...paginacion,
        historico: z
          .boolean()
          .default(false)
          .describe("Incluir normativa histórica en la búsqueda."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const { desde, hasta } = rangoPagina(args.pagina, args.por_pagina);
        const datos = await cliente.buscarNormas({
          texto: args.texto,
          numero: args.numero,
          fechaDesde: args.fecha_desde,
          fechaHasta: args.fecha_hasta,
          sector: args.sector,
          materia: args.materia,
          tipoDispositivo: args.tipo_dispositivo,
          agrupacion: args.agrupacion,
          historico: args.historico,
          orden: args.orden,
          desde,
          hasta,
        });
        return textoSalida(datos);
      } catch (error) {
        return errorSalida(error);
      }
    },
  );

  server.registerTool(
    "buscar_jurisprudencia",
    {
      title: "Buscar jurisprudencia en el SPIJ",
      description:
        "Busca jurisprudencia peruana (casaciones, expedientes, sentencias, resoluciones del Tribunal Constitucional, plenos jurisdiccionales, etc.) en el SPIJ. Devuelve metadatos, sumilla, total y facetas. En el acceso libre la sumilla y los metadatos están disponibles; el texto completo de las resoluciones suele requerir suscripción (consulta obtener_documento).",
      inputSchema: {
        ...filtrosComunes,
        ...paginacion,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const { desde, hasta } = rangoPagina(args.pagina, args.por_pagina);
        const datos = await cliente.buscarJurisprudencia({
          texto: args.texto,
          numero: args.numero,
          fechaDesde: args.fecha_desde,
          fechaHasta: args.fecha_hasta,
          sector: args.sector,
          materia: args.materia,
          tipoDispositivo: args.tipo_dispositivo,
          agrupacion: args.agrupacion,
          orden: args.orden,
          desde,
          hasta,
        });
        return textoSalida(datos);
      } catch (error) {
        return errorSalida(error);
      }
    },
  );

  server.registerTool(
    "obtener_documento",
    {
      title: "Obtener un documento del SPIJ",
      description:
        "Descarga el detalle de una norma o resolución a partir de su identificador del SPIJ (campo 'id' de los resultados, por ejemplo 'H1453514'). Incluye sumilla y, cuando el SPIJ lo permite, el texto completo. El campo texto_disponible indica si el texto se obtuvo o si está reservado a suscriptores. Los textos largos se leen por partes con 'desde' (total_caracteres da el tamaño). Las referencias a otras normas aparecen como [H…] (su id, para abrirlas) y los PDF enlazados como [https://…]; el campo pdfs los lista con su descripción (Anexo, Exposición de motivos…). Si el texto dice DEROGADO, abre la norma que lo deroga. Si un anexo (por ejemplo el texto de un TUO) se publicó aparte, aparece como [H…]: ábrelo, suele traer el texto completo.",
      inputSchema: {
        id: z.string().min(3).describe("Identificador del SPIJ, por ejemplo 'H1453514'."),
        max_caracteres: z
          .number()
          .int()
          .min(1000)
          .max(100000)
          .default(12000)
          .describe("Máximo de caracteres del texto completo a devolver."),
        desde: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Carácter desde el que leer el texto, para continuar un texto recortado."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const datos = await cliente.obtenerDocumento(args.id, {
          maxChars: args.max_caracteres,
          desde: args.desde,
        });
        return textoSalida(datos);
      } catch (error) {
        return errorSalida(error);
      }
    },
  );

  server.registerTool(
    "exportar_documento",
    {
      title: "Exportar un documento del SPIJ",
      description:
        "Guarda un documento del SPIJ en la carpeta Descargas/SPIJ del usuario, completo (sin el límite de caracteres de obtener_documento). formato 'word' genera el mismo archivo .doc que el botón Descargar del SPIJ; formato 'pdf' descarga los PDF originales que el documento enlaza (útil cuando la norma solo se publica como PDF). Devuelve las rutas de los archivos guardados. No exporta textos reservados a suscriptores.",
      inputSchema: {
        id: z.string().min(3).describe("Identificador del SPIJ, por ejemplo 'H1386858'."),
        formato: z.enum(["word", "pdf"]).default("word").describe("'word' (.doc) o 'pdf' (PDF original enlazado)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        const archivos = await cliente.exportar(args.id, args.formato);
        // Import dinámico: el Worker de Cloudflare no tiene sistema de archivos.
        const [fs, os, path] = await Promise.all([
          import("node:fs/promises"),
          import("node:os"),
          import("node:path"),
        ]);
        const carpeta = path.join(os.homedir(), "Downloads", "SPIJ");
        await fs.mkdir(carpeta, { recursive: true });
        const guardados = [];
        for (const archivo of archivos) {
          const ruta = path.join(carpeta, path.basename(archivo.nombre));
          await fs.writeFile(ruta, archivo.datos);
          guardados.push({ ruta, bytes: archivo.datos.length });
        }
        return textoSalida({ guardados });
      } catch (error) {
        return errorSalida(error);
      }
    },
  );

  server.registerTool(
    "catalogo_spij",
    {
      title: "Consultar catálogos del SPIJ",
      description:
        "Devuelve los catálogos oficiales del SPIJ (agrupaciones, tipos de dispositivo legal, sectores, materias, tomos) para construir búsquedas con identificadores válidos. Se puede filtrar por texto.",
      inputSchema: {
        tipo: z
          .enum([
            "todo",
            "agrupaciones",
            "tipos_dispositivo",
            "sectores",
            "materias",
            "tomos",
          ])
          .default("todo")
          .describe("Catálogo a consultar."),
        filtro: z
          .string()
          .optional()
          .describe("Texto para filtrar los valores del catálogo (sin distinguir mayúsculas)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const catalogos = await cliente.catalogos();
        const filtro = (args.filtro || "").toLowerCase();

        const filtrar = (items) => {
          if (!Array.isArray(items)) return items;
          const lista = items.map((x) =>
            typeof x === "string" ? { id: x, nombre: x } : x,
          );
          return filtro
            ? lista.filter((x) =>
                `${x.id ?? ""} ${x.nombre ?? ""}`.toLowerCase().includes(filtro),
              )
            : lista;
        };

        let salida;
        switch (args.tipo) {
          case "agrupaciones":
            salida = { agrupaciones: filtrar(catalogos.agrupaciones) };
            break;
          case "tipos_dispositivo":
            salida = { tipos_dispositivo_legal: filtrar(catalogos.tipos_dispositivo_legal) };
            break;
          case "sectores":
            salida = { sectores: filtrar(catalogos.sectores) };
            break;
          case "tomos":
            salida = { tomos: filtrar(catalogos.tomos) };
            break;
          case "materias": {
            const materias = {};
            for (const [grupo, items] of Object.entries(catalogos.materias || {})) {
              const lista = filtrar(items);
              if (!filtro || (Array.isArray(lista) && lista.length > 0)) {
                materias[grupo] = lista;
              }
            }
            salida = { materias };
            break;
          }
          default:
            salida = {
              agrupaciones: filtrar(catalogos.agrupaciones),
              tipos_dispositivo_legal: filtrar(catalogos.tipos_dispositivo_legal).slice(0, 200),
              sectores: filtrar(catalogos.sectores).slice(0, 300),
              tomos: filtrar(catalogos.tomos),
              materias: catalogos.materias,
            };
        }

        return textoSalida(salida);
      } catch (error) {
        return errorSalida(error);
      }
    },
  );

  server.registerTool(
    "diagnostico_spij",
    {
      title: "Diagnóstico de la conexión con el SPIJ",
      description:
        "Comprueba que la sesión con el SPIJ funciona y devuelve el modo de acceso (libre o suscriptor), el total de normas y de jurisprudencia indexadas y la latencia. Útil para verificar un despliegue.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const datos = await cliente.diagnostico();
        return textoSalida({
          ...datos,
          version: VERSION,
          repositorio: esRepoConfigurado(repo) ? repo : null,
        });
      } catch (error) {
        return errorSalida(error);
      }
    },
  );

  server.registerTool(
    "comprobar_actualizacion",
    {
      title: "Comprobar actualizaciones de la extensión",
      description:
        "Comprueba en GitHub si hay una versión más reciente de esta extensión y, si la hay, devuelve el enlace de descarga del archivo .mcpb. Usa esta herramienta cuando el usuario pregunte si hay actualizaciones o cómo actualizar. El resultado se cachea unas horas.",
      inputSchema: {
        forzar: z
          .boolean()
          .default(false)
          .describe("Ignorar la caché y consultar GitHub de nuevo."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const datos = await comprobarActualizacion({
          repo,
          forzar: args.forzar,
        });
        return textoSalida(datos);
      } catch (error) {
        return errorSalida(error);
      }
    },
  );
}
