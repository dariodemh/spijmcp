# spij-mcp

Extensión MCP no oficial para buscar **normas y jurisprudencia del SPIJ** (Sistema Peruano de Información Jurídica, MINJUS) desde Claude, ChatGPT, Gemini y cualquier cliente compatible con MCP. Corre **100% en tu computadora** y consulta el SPIJ desde tu propia conexión.

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

### ChatGPT (Desktop/Web), Gemini (Desktop/Web) y Claude Web (`claude.ai`)

**En Windows (recomendado — no requiere Node.js ni consola):**

1. Descarga **`SPIJ-MCP-Setup.exe`** desde la [última release](https://github.com/dariodemh/spijmcp/releases/latest) e instálalo.
   > *Nota:* Como es un instalador independiente sin firma comercial, Windows SmartScreen puede mostrar un aviso azul. Haz clic en **Más información → Ejecutar de todas formas**.
2. Al terminar, se abre el panel de **SPIJ MCP** con tu **URL fija permanente** (`https://spijmcp.dariomorales.com/u/.../mcp`). Haz clic en **Copiar URL**.
3. Pégala **una sola vez** (no cambia al reiniciar tu PC) en:
   - **ChatGPT:** *Configuración → Aplicaciones / Conectores → Modo desarrollador → Crear*
   - **Gemini (Desktop/Web):** *Developer Mode* / conectores MCP
   - **Claude Web (`claude.ai`):** *Configuración → Conectores → Agregar conector personalizado*

SPIJ MCP queda activo en segundo plano junto al reloj de Windows (puedes activar o desactivar el inicio automático y guardar tu cuenta suscriptora del SPIJ desde el mismo panel). Todo sigue corriendo en tu propia PC, con tu IP y tu carpeta `Descargas/SPIJ`; el puente solo reenvía las peticiones mientras tu app está abierta y no guarda consultas ni credenciales.

**En macOS / Linux (requiere Node.js 22+):**

```bash
git clone https://github.com/dariodemh/spijmcp && cd spijmcp && npm install
node src/server.js --ui
```

### Claude Desktop

Descarga el archivo `.mcpb` de la [última release](https://github.com/dariodemh/spijmcp/releases/latest) y ábrelo con doble clic (o *Configuración → Extensiones*). Los campos de usuario y clave del SPIJ son opcionales.

### Claude Code

```powershell
git clone https://github.com/dariodemh/spijmcp && cd spijmcp && npm install
claude mcp add spij -s user -- node "$PWD/src/server.js"
```

Para usar tu cuenta de suscriptor, añade `--env SPIJ_USUARIO=... --env SPIJ_CLAVE=...`.

<details>
<summary>Opciones avanzadas del modo HTTP / Relay / Túnel</summary>

- `node src/server.js --ui`: inicia el panel gráfico local + URL fija permanente vía relay (en Windows también disponible haciendo doble clic en [`Iniciar-SPIJ-HTTP.bat`](Iniciar-SPIJ-HTTP.bat)).
- `node src/server.js --relay [url]`: conecta por consola al relay (por defecto `https://spijmcp.dariomorales.com`) y copia la URL fija al portapapeles.
- `node src/server.js --tunnel`: abre un túnel temporal de Cloudflare (`trycloudflare.com`, descarga `cloudflared` automáticamente).
- `node src/server.js --http`: inicia solo el servidor local en `http://127.0.0.1:3000/mcp` (estado en `/health`).
- `--port <puerto>` / `SPIJ_MCP_PORT` / `PORT` (por defecto `3000`).
- `--host <ip>` / `SPIJ_MCP_HOST` / `HOST` (por defecto `127.0.0.1`).
- `--token <secreto>` / `SPIJ_MCP_TOKEN`: protege `/mcp` exigiendo `Authorization: Bearer <secreto>`.
- `--sin-exportar` / `SPIJ_MCP_SIN_EXPORTAR=1`: oculta `exportar_documento`.

</details>

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
npm test             # pruebas (UI, relay, HTTP, protocolo MCP y SPIJ en vivo)
npm run build:mcpb   # genera dist/spij-mcp-<versión>.mcpb
npm run build:win    # en Windows, genera dist/SPIJ-MCP-Setup.exe (requiere Inno Setup 6)
```

Para publicar una versión: sube `version` en `package.json`, `manifest.json` y `src/config.js`, haz commit y crea la etiqueta `vX.Y.Z`; el workflow de GitHub construye automáticamente el `.mcpb` y `SPIJ-MCP-Setup.exe` y los adjunta a la release.

La API interna del SPIJ (no oficial, puede cambiar sin aviso) está documentada en [`docs/API.md`](docs/API.md).

## Límites

- No es una API oficial: el MINJUS puede cambiarla o bloquearla.
- El SPIJ no admite frases entre comillas ni consultas largas; funcionan mejor 2 a 4 palabras clave o el número de la norma.
- Máximo 20 resultados por página.

## Aviso legal

Proyecto no afiliado al MINJUS. Respeta los términos de uso del SPIJ: configura solo tu propia cuenta y no hagas consultas masivas. Las normas y resoluciones pertenecen a sus autores y editores. Antes de citar, verifica la fuente original.

Código bajo licencia MIT.
