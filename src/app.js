/**
 * Construcción del servidor MCP y del cliente SPIJ compartidos por los
 * distintos transportes (stdio / HTTP / Cloudflare Workers) y por las pruebas.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SpijClient } from "./spij.js";
import { registrarHerramientas } from "./tools.js";
import { VERSION, resolverRepo } from "./config.js";

export { VERSION };

const ENV = typeof process !== "undefined" && process.env ? process.env : {};

const INSTRUCCIONES = `Esta extensión consulta el Sistema Peruano de Información Jurídica (SPIJ) del MINJUS.
Usa buscar_normas para legislación, buscar_jurisprudencia para casaciones, sentencias y resoluciones, obtener_documento para el detalle de un resultado y catalogo_spij para conocer los filtros válidos.
Cómo buscar con precisión:
1. Si el usuario da el número de la norma o del expediente, búscalo con el campo numero.
2. Si solo da un nombre ("el TUO de la LPAG"), identifica primero su número con lo que sabes y búscalo por número; si el pedido es ambiguo (varias normas posibles, sin año, etc.), pregúntale al usuario antes de buscar.
3. Lo que sabes puede estar desactualizado: después de encontrarla, comprueba que sigue vigente. Si el texto dice DEROGADO, abre la norma que la deroga (su id aparece como [H…]). Para un TUO o un reglamento, busca también con palabras clave y el tipo de dispositivo por si hay uno más reciente.
4. En texto usa pocas palabras clave y sin comillas.
Para entregar un documento completo como archivo usa exportar_documento; para leer un texto largo, obtener_documento con desde.
El acceso libre entrega metadatos y sumillas; el texto completo de la jurisprudencia puede requerir una cuenta de suscriptor configurada por el usuario.
Si el usuario pregunta si hay una versión nueva o cómo actualizar la extensión, usa comprobar_actualizacion.`;

/** Crea un cliente SPIJ a partir de variables de entorno o de opciones. */
export function crearCliente(opciones = {}) {
  return new SpijClient({
    usuario: opciones.usuario ?? ENV.SPIJ_USUARIO,
    clave: opciones.clave ?? ENV.SPIJ_CLAVE,
    ...opciones,
  });
}

/**
 * Crea el servidor MCP con todas las herramientas registradas.
 *
 * @param {SpijClient} cliente
 * @param {object} [opciones]
 * @param {string} [opciones.repo]         Repositorio GitHub para actualizaciones.
 * @param {string} [opciones.instructions] Nota adicional para el modelo.
 */
export function crearServidor(cliente, opciones = {}) {
  const repo = resolverRepo(opciones.repo);
  const instructions = [INSTRUCCIONES, opciones.instructions]
    .filter(Boolean)
    .join("\n\n");

  const server = new McpServer(
    {
      name: "spij-mcp",
      version: VERSION,
      description:
        "Búsqueda de normas y jurisprudencia del Sistema Peruano de Información Jurídica (SPIJ).",
    },
    { instructions },
  );

  registrarHerramientas(server, cliente, { repo });
  return server;
}
