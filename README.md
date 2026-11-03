# spij-mcp

Servidor **MCP (Model Context Protocol)** no oficial para buscar **normas y jurisprudencia del SPIJ** (Sistema Peruano de Información Jurídica, MINJUS) directamente desde Claude, Cursor, VS Code Copilot u otro cliente compatible con MCP.

Permite que un asistente consulte el SPIJ con herramientas reales en lugar de intentar navegar el sitio web o inventar citas:

| Herramienta | Qué hace |
|---|---|
| `buscar_normas` | Busca legislación: leyes, decretos supremos, resoluciones ministeriales, ordenanzas, etc. |
| `buscar_jurisprudencia` | Busca casaciones, expedientes, sentencias del TC, plenos jurisdiccionales, resoluciones administrativas. |
| `obtener_documento` | Trae el detalle de un documento por su `id` (sumilla y texto completo cuando el SPIJ lo permite). Los textos largos se leen por partes con `desde`. |
| `exportar_documento` | Guarda el documento completo en `Descargas/SPIJ`: Word (.doc, igual que el botón Descargar del SPIJ) o el PDF original cuando el SPIJ lo enlaza. |
| `catalogo_spij` | Devuelve catálogos oficiales (agrupaciones, tipos de dispositivo, sectores, materias, tomos) para filtrar bien. |
| `diagnostico_spij` | Verifica la conexión y el modo de acceso (libre o suscriptor). |
| `comprobar_actualizacion` | Consulta GitHub y avisa si hay una versión nueva de la extensión, con enlace de descarga. |

La extensión se puede distribuir como archivo `.mcpb` para Claude Desktop o consumir desde GitHub con `npx`. Incluye una guía en PDF para abogados en [`docs/SPIJ-en-Claude-Guia.pdf`](docs/SPIJ-en-Claude-Guia.pdf) y una guía técnica en [`docs/GUIA-USUARIO.md`](docs/GUIA-USUARIO.md).

Probado contra el SPIJ en vivo: búsquedas por texto, filtros por tipo, sector, fechas y paginación funcionan.

---

## 1. Cómo funciona (lo que hay detrás)

El SPIJ es una SPA Angular. No tiene API pública documentada, pero el propio front-end consume dos servicios JSON:

```
https://spij.minjus.gob.pe/spij-ext-web        (SPA Angular)
https://spijwsii.minjus.gob.pe/spij-ext-back   (login, catálogos, detalle)
https://spijwsii.minjus.gob.pe/spij-ext-solr   (búsqueda, índice Solr)
```

Flujo que reproduce este proyecto:

1. `POST /spij-ext-back/authenticate` con la cuenta invitada que usa el botón **ACCESO LIBRE** → JWT para metadatos.
2. `POST /spij-ext-solr/authenticate` → JWT para el buscador.
3. `POST /spij-ext-solr/api/buscar` con `tipoNorma: "NR"` (normas) o `"JR"` (jurisprudencia).
4. `GET /spij-ext-back/api/detallenorma/{id}` → detalle.

### Acceso libre vs. suscriptor

| | Acceso libre (sin credenciales) | Con tu cuenta de suscriptor |
|---|---|---|
| Metadatos (id, código, fecha, tipo, sector, ruta) | ✅ | ✅ |
| Sumilla | ✅ | ✅ |
| Texto completo de **normas recientes** (leyes, decretos, ordenanzas) | ✅ en la mayoría | ✅ |
| Texto completo de **jurisprudencia** (casaciones, expedientes, sentencias) | ❌ (aviso de suscripción) | ✅ |
| Catálogos y facetas | ✅ | ✅ |

La disponibilidad del texto varía por documento: el MCP devuelve `texto_disponible: true/false` en cada consulta a `obtener_documento` y un `aviso` cuando está restringido. El MCP **no elude la suscripción**: usa el mismo acceso libre que un visitante, y solo consulta el texto restringido si configuras tu propia cuenta (`SPIJ_USUARIO` / `SPIJ_CLAVE`).

Los tokens JWT se cachean y renuevan solos; las peticiones se espacian (300 ms por defecto) para no saturar el servicio.

---

## 2. Instalación

Requisitos: **Node.js 18 o superior** (probado con Node 24).

```powershell
cd spij-mcp
npm install
npm test          # prueba contra el SPIJ en vivo
```

`npm test` ejecuta tres comprobaciones: cliente real, protocolo MCP en memoria y runtime web (Cloudflare).

---

## 3. Instalar como extensión de Claude Desktop (recomendado para compartir)

La forma más simple de que **cada persona lo corra en su propia PC**, sin VPS ni hosting: empaquetar el MCP como extensión `.mcpb`. Claude Desktop ya incluye Node, así que quien la instala no necesita nada más.

Construir el paquete (una vez, en tu laptop):

```powershell
npm run build:mcpb
# o: powershell -ExecutionPolicy Bypass -File scripts\build-mcpb.ps1
```

Genera `dist\spij-mcp-0.2.0.mcpb` (~3 MB, solo JavaScript: sirve en Windows, macOS y Linux).

Instalarlo:

1. Abre Claude Desktop → **Settings → Extensions → Advanced settings → Install Extension…**
2. Elige el archivo `.mcpb` (o haz doble clic sobre él).
3. Aparece un formulario con dos campos opcionales: usuario y contraseña del SPIJ. Déjalos vacíos para acceso libre.
4. Listo: las herramientas quedan disponibles en el chat. Todo corre en tu equipo y las consultas salen desde tu conexión.

Si Claude muestra un aviso de «editor no verificado», es normal: el paquete no está firmado. Para distribución amplia puedes firmarlo con `mcpb sign`.

Para compartirlo, basta pasar el archivo `.mcpb`: cada persona lo instala y queda independiente. Para publicar una versión nueva, sube `version` en `manifest.json`, `package.json` y `src/config.js`, vuelve a construir y reinstala.

Ventajas de este modelo: sin servidores, sin costos de hosting, sin tokens compartidos y cada usuario consulta el SPIJ desde su propia IP (útil si hay geo-bloqueo o cuentas distintas).

### Actualizaciones

La extensión incluye la herramienta `comprobar_actualizacion`, que consulta las releases del repositorio y responde si hay una versión nueva, con el enlace del `.mcpb`. Para que funcione, define tu repositorio antes de construir (una sola vez):

- En `src/config.js`: cambia `REPO_POR_DEFECTO` por `"dariodemh/spijmcp"`.
- En `manifest.json`: cambia el valor de `SPIJ_MCP_REPO` por el mismo repositorio.

Con eso, al instalar la extensión cada usuario puede preguntar «¿hay actualizaciones?» y Claude usará la herramienta. Además, al arrancar el servidor se hace una comprobación silenciosa (2,5 s como máximo) y, si hay versión nueva, se le avisa al modelo. Se puede desactivar con `SPIJ_MCP_CHECK_UPDATES=0`.

El workflow de release adjunta el `.mcpb` y la guía a cada etiqueta `v*`, así que el enlace de descarga que devuelve la herramienta siempre apunta a la última versión.

La guía lista para enviar a los usuarios finales está en [`docs/GUIA-USUARIO.md`](docs/GUIA-USUARIO.md).

## 4. Conectar a Claude Desktop (Windows)

Alternativa manual, si prefieres no empaquetar la extensión o necesitas apuntar a una copia concreta del código.

La ruta del archivo de configuración depende de cómo hayas instalado Claude Desktop:

- **Microsoft Store**: `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`
- **Instalador normal**: `%APPDATA%\Claude\claude_desktop_config.json`

La forma más segura de encontrarlo es abrir Claude Desktop → **Settings → Developer → Edit Config**. Añade:

```json
{
  "mcpServers": {
    "spij": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "C:\\Users\\D\\Documents\\deepseek-harness\\default-workspace\\spij-mcp\\src\\server.js"
      ],
      "env": {
        "SPIJ_USUARIO": "",
        "SPIJ_CLAVE": ""
      }
    }
  }
}
```

- Usa la ruta **absoluta** a `src/server.js` y a `node.exe`: Claude Desktop no siempre hereda el PATH y `"command": "node"` puede fallar con `spawn ENOENT`.
- Deja `SPIJ_USUARIO` y `SPIJ_CLAVE` vacíos para acceso libre; complétalos con tu cuenta del SPIJ para el texto restringido.
- Reinicia Claude Desktop por completo (no basta cerrar la ventana). Deberían aparecer las cinco herramientas.

## 5. Conectar a Claude Code y otros clientes

El servidor es un MCP estándar por stdio, así que funciona en cualquier cliente compatible: Claude Code, Codex, Cursor, VS Code, DeepSeek Harness, Gemini CLI, etc.

### Opción local (sin GitHub)

```powershell
claude mcp add spij -- node "C:\Users\D\Documents\deepseek-harness\default-workspace\spij-mcp\src\server.js"
```

Con suscripción:

```powershell
claude mcp add spij --env SPIJ_USUARIO=tu_usuario --env SPIJ_CLAVE=tu_clave -- node "C:\...\src\server.js"
```

### Opción desde GitHub (recomendada para varios equipos)

Sube el proyecto a un repositorio y cualquier cliente lo ejecuta sin clonar ni compilar:

```powershell
npx -y github:dariodemh/spijmcp
```

npm descarga el repo, instala las dependencias y ejecuta el servidor. Se puede anclar una versión: `npx -y github:dariodemh/spijmcp#v0.1.0`.

Publicarlo:

```powershell
cd spij-mcp
git init
git add .
git commit -m "MCP del SPIJ"
gh repo create spij-mcp --public --source=. --push
git tag v0.1.0
git push --tags
```

El workflow [`.github/workflows/release.yml`](.github/workflows/release.yml) construye el `.mcpb` en cada etiqueta `v*` y lo adjunta a la release de GitHub.

Si además ejecutas `npm publish` (el nombre `spij-mcp` estaba libre al escribir esto; quita `"private": true` del `package.json`), también funciona `npx -y spij-mcp`.

### Configuración por cliente

Todos usan el mismo comando `npx -y github:dariodemh/spijmcp` con las variables `SPIJ_USUARIO` / `SPIJ_CLAVE` opcionales:

| Cliente | Archivo de configuración | Ejemplo |
|---|---|---|
| Claude Code | `.mcp.json` del proyecto o `claude mcp add` | [`examples/claude-code-mcp.json`](examples/claude-code-mcp.json) |
| Codex CLI | `~/.codex/config.toml` | [`examples/codex-config.toml`](examples/codex-config.toml) |
| DeepSeek Harness (DSH) | `~/.dsh/profiles/desktop/cordis.patch.yml` | [`examples/dsh-cordis-patch.yml`](examples/dsh-cordis-patch.yml) |
| Cursor | `~/.cursor/mcp.json` | [`examples/cursor-mcp.json`](examples/cursor-mcp.json) |
| VS Code (Copilot) | `.vscode/mcp.json` | [`examples/vscode-mcp.json`](examples/vscode-mcp.json) |
| Gemini CLI | `~/.gemini/settings.json` | [`examples/gemini-settings.json`](examples/gemini-settings.json) |

#### DeepSeek Harness (DSH)

DSH incluye soporte MCP nativo con el paquete `@deepseek-ai/dsh-mcp-client`. Añade la entrada a tu `cordis.patch.yml` y reinicia DSH:

```yaml
- id: mcp-spij
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: spij
    transport: stdio
    command: npx
    args: ["-y", "github:dariodemh/spijmcp"]
    env:
      SPIJ_USUARIO: ""
      SPIJ_CLAVE: ""
```

Las herramientas aparecen en el modelo como `mcp__spij__buscar_normas`, `mcp__spij__buscar_jurisprudencia`, `mcp__spij__obtener_documento`, etc.

#### Requisitos

- **Node.js 18+** para `npx`. Claude Desktop no lo necesita si usas la extensión `.mcpb`.
- Repositorio público; si es privado, `npx github:` pedirá credenciales de GitHub.
- En Windows, si un cliente no resuelve `npx`, usa `npx.cmd` o `"command": "node"` con la ruta absoluta a `src/server.js`.


## 6. Modo remoto (Streamable HTTP)

Opcional: solo hace falta si quieres un endpoint único (por ejemplo, para `claude.ai` o para no instalar nada en cada equipo). Para uso local o de equipo pequeño, la extensión de la sección 3 evita todo esto.

```powershell
$env:MCP_AUTH_TOKEN = "una-clave-larga-y-aleatoria"
$env:PORT = "8787"
node src/server.js --http
```

- Endpoint: `http://127.0.0.1:8787/mcp`
- Salud: `GET http://127.0.0.1:8787/health`
- Autenticación: `Authorization: Bearer <MCP_AUTH_TOKEN>` (o cabecera `X-API-Key`).
- Límite por defecto: 120 peticiones/minuto por IP (`MCP_RATE_LIMIT`).

En el cliente remoto:

```powershell
claude mcp add --transport http spij https://spij.pudu.app/mcp --header "Authorization: Bearer una-clave-larga-y-aleatoria"
```

---

## 7. Desplegar en `spij.pudu.app`

Solo si necesitas el endpoint remoto. Para que cada uno lo use en su PC, no hace falta desplegar nada: usa la extensión local (sección 3).

El MCP necesita ejecutar JavaScript/Node. **El hosting compartido con solo PHP no sirve** para esto (el juego estático sí, el MCP no). Opciones, de más simple a más control:

### Opción A — Cloudflare Workers (recomendada, gratis)

El proyecto incluye `src/worker.js`, una variante que corre en el runtime de Workers (APIs web estándar) y ya fue probada localmente.

```powershell
npm install -g wrangler
wrangler login

wrangler secret put MCP_AUTH_TOKEN
wrangler secret put SPIJ_USUARIO     # opcional
wrangler secret put SPIJ_CLAVE       # opcional

wrangler deploy
```

`wrangler.toml` ya apunta a `src/worker.js`. Luego, en el DNS de tu dominio, apunta `spij.pudu.app` al Worker (registro CNAME que te da Cloudflare) y la URL queda `https://spij.pudu.app/mcp`.

### Opción B — VPS o PaaS con Docker

Incluye `Dockerfile`:

```bash
docker build -t spij-mcp .
docker run -p 8787:8787 -e MCP_AUTH_TOKEN=secreto spij-mcp
```

Cualquier VPS (Hostinger VPS, DigitalOcean, etc.) o PaaS gratuito (Render, Railway, Fly.io) lo ejecuta. Detrás de Nginx/Caddy, con HTTPS y el token configurado.

### Geo-bloqueo

Los servidores del MINJUS pueden filtrar tráfico extranjero. Si el Worker o el VPS no logra conectarse al SPIJ, prueba desde una IP peruana (por ejemplo, un VPS en Lima) o consulta con la oficina del SPIJ.

---

## 8. Ejemplos de uso en el chat

- «Busca casaciones laborales de 2025 sobre despido arbitrario y hazme un cuadro con sumilla y número.»
- «¿Qué normas se publicaron ayer sobre contrataciones del Estado?»
- «Encuentra jurisprudencia del Tribunal Constitucional sobre el derecho al agua y resume las sumillas.»
- «Tráeme el detalle del documento H1453514 y dime si el texto completo está disponible.»

El asistente llamará a las herramientas y recibirá JSON con `id`, `codigo`, `fecha`, `tipo`, `sector`, `ruta`, `sumilla` y `url` al documento.

---

## 9. Estructura

```
spij-mcp/
├── src/
│   ├── spij.js        Cliente de la API del SPIJ (auth, búsqueda, detalle, catálogos)
│   ├── tools.js       Definición de las herramientas MCP
│   ├── updates.js     Comprobación de versiones contra GitHub
│   ├── config.js      Versión y repositorio (editar antes de publicar)
│   ├── app.js         Fábrica del servidor MCP
│   ├── server.js      Entrada stdio / HTTP
│   └── worker.js      Variante Cloudflare Workers
├── test/
│   ├── smoke.js       Prueba real contra el SPIJ
│   ├── mcp-protocol.js Prueba MCP en memoria
│   ├── mcp-http.js    Prueba del transporte HTTP (servidor levantado)
│   ├── web-standard.js Prueba del handler de Workers
│   └── updates.js     Prueba de la comprobación de versiones
├── docs/
│   ├── API.md         Documentación de la API interna encontrada
│   └── GUIA-USUARIO.md Guía para quienes instalan la extensión
├── examples/          Configuración lista para cada cliente MCP
│   ├── claude_desktop_config.json
│   ├── claude-code-mcp.json
│   ├── codex-config.toml
│   ├── cursor-mcp.json
│   ├── dsh-cordis-patch.yml
│   ├── gemini-settings.json
│   └── vscode-mcp.json
├── scripts/
│   ├── build-mcpb.mjs Construye la extensión .mcpb (multiplataforma)
│   └── build-mcpb.ps1 Envoltorio para Windows
├── .github/workflows/release.yml  Publica el .mcpb en cada etiqueta
├── manifest.json      Manifiesto de la extensión de Claude Desktop
├── icon.png           Icono de la extensión
├── dist/              Paquete .mcpb generado
├── Dockerfile
├── .dockerignore
├── wrangler.toml
└── .env.example
```

---

## 10. Límites conocidos

- **Texto completo**: las normas recientes suelen incluir texto completo en el acceso libre; la jurisprudencia (casaciones, expedientes, sentencias) muestra el aviso de suscripción. Configura tu cuenta para el texto restringido.
- **Sin descarga de PDF**: el endpoint `procesarpdf` requiere sesión de suscriptor; no se usa aquí.
- **No es API oficial**: MINJUS puede cambiarla o bloquearla sin aviso. Si algo falla, revisa `npm run smoke`.
- **Paginación**: máximo 20 resultados por página (límite del MCP); el índice tiene cientos de miles de documentos, usa filtros y texto para acotar.
- **Sintaxis de búsqueda**: el texto se envía al índice Solr; admite comillas para frases exactas y operadores, pero no está documentada.
- **Tokens**: caducan (≈24 h); el cliente los renueva solo. Si aparece 401/403 repetido, reinicia el proceso.

---

## 11. Aviso legal y uso responsable

- Este proyecto **no está afiliado al MINJUS** ni cuenta con soporte oficial.
- Usa el acceso libre que el propio SPIJ ofrece al público y **no elude la suscripción** ni accede a cuentas ajenas.
- Configura solo **tu propia** cuenta de suscriptor, si la tienes.
- Respeta los términos de uso del SPIJ y la normativa de protección de datos: no hagas raspado masivo, mantén el ritmo de peticiones y cita la fuente.
- Para un servicio público o comercial, conviene pedir autorización a la oficina del SPIJ (`consulta.spij@minjus.gob.pe`).
- El contenido (normas, sumillas, resoluciones) pertenece a sus autores/editor; este MCP solo facilita la consulta.

---

## 12. Solución de problemas

| Síntoma | Causa probable / solución |
|---|---|
| `401` / `403` al buscar | Token caducado o IP bloqueada; espera un minuto y reintenta. |
| `500 "No se ha podido ejecutar la consulta"` | Filtros incompatibles (p. ej. materia que no aplica al tipo). Reduce filtros. |
| `Timeout` | Red lenta o bloqueo geográfico; prueba desde otra red/VPS. |
| Claude Desktop no ve el servidor | Ruta relativa, Node fuera del PATH o JSON mal formado; revisa los logs de Claude Desktop. |
| `npm install` falla en Windows con EPERM | Caché de npm en una carpeta sin permisos; usa `npm install --cache ./.npm-cache`. |
| El worker de Cloudflare no conecta | Posible geo-bloqueo del MINJUS; despliega en VPS peruano o consulta al SPIJ. |

---

## 13. Créditos y licencia

Código bajo licencia MIT. Datos y marcas del SPIJ pertenecen al MINJUS.
