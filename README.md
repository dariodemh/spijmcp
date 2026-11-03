# spij-mcp

Extensión MCP no oficial para buscar **normas y jurisprudencia del SPIJ** (Sistema Peruano de Información Jurídica, MINJUS) desde Claude. Corre en tu computadora y consulta el SPIJ desde tu propia conexión.

| Herramienta | Qué hace |
|---|---|
| `buscar_normas` | Busca legislación: leyes, decretos, resoluciones, ordenanzas. |
| `buscar_jurisprudencia` | Busca casaciones, expedientes, sentencias del TC, plenos. |
| `obtener_documento` | Trae el detalle de un documento por su `id`; los textos largos se leen por partes con `desde`. |
| `exportar_documento` | Guarda el documento completo en `Descargas/SPIJ`: Word (.doc, como el botón Descargar del SPIJ) o el PDF original cuando el SPIJ lo enlaza. |
| `catalogo_spij` | Catálogos oficiales (tipos de dispositivo, sectores, materias) para filtrar. |
| `diagnostico_spij` | Verifica la conexión y el modo de acceso. |
| `comprobar_actualizacion` | Avisa si hay una versión nueva en GitHub. |

Guía para abogados: [`docs/SPIJ-en-Claude-Guia.pdf`](docs/SPIJ-en-Claude-Guia.pdf).

## Instalar

**Claude Desktop:** descarga el `.mcpb` de la [última release](https://github.com/dariodemh/spijmcp/releases/latest) y ábrelo con doble clic (o *Configuración → Extensiones*). Los campos de usuario y clave del SPIJ son opcionales.

**Claude Code:**

```powershell
git clone https://github.com/dariodemh/spijmcp && cd spijmcp && npm install
claude mcp add spij -s user -- node "$PWD/src/server.js"
```

Para usar tu cuenta de suscriptor, añade `--env SPIJ_USUARIO=... --env SPIJ_CLAVE=...`.

## Acceso libre y suscriptor

| | Acceso libre | Con tu cuenta |
|---|---|---|
| Metadatos y sumilla | ✅ | ✅ |
| Texto de normas | ✅ en la mayoría | ✅ |
| Texto de jurisprudencia | ❌ | ✅ |

El MCP indica `texto_disponible: false` cuando el texto está reservado y **no elude la suscripción**: solo accede al texto restringido con tu propia cuenta.

## Desarrollo

```powershell
npm install
npm test             # pruebas contra el SPIJ en vivo (requiere internet)
npm run build:mcpb   # genera dist/spij-mcp-<versión>.mcpb
```

Para publicar una versión: sube `version` en `package.json`, `manifest.json` y `src/config.js`, haz commit y crea la etiqueta `vX.Y.Z`; el workflow de GitHub construye el `.mcpb` y lo adjunta a la release.

La API interna del SPIJ (no oficial, puede cambiar sin aviso) está documentada en [`docs/API.md`](docs/API.md).

## Límites

- No es una API oficial: el MINJUS puede cambiarla o bloquearla.
- El SPIJ no admite frases entre comillas ni consultas largas; funcionan mejor 2 a 4 palabras clave o el número de la norma.
- Máximo 20 resultados por página.

## Aviso legal

Proyecto no afiliado al MINJUS. Respeta los términos de uso del SPIJ: configura solo tu propia cuenta y no hagas consultas masivas. Las normas y resoluciones pertenecen a sus autores y editores. Antes de citar, verifica la fuente original.

Código bajo licencia MIT.
