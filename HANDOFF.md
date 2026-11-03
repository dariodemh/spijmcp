# Handoff — spij-mcp

Nota de traspaso para continuar el proyecto con otro asistente o en otra sesión.
Fecha: 2026-11-03. Versión: 0.2.0.

## Qué es

Servidor MCP no oficial para buscar normas y jurisprudencia del SPIJ (MINJUS, Perú) desde Claude Desktop.
La API interna del SPIJ fue reconstruida desde el bundle del front-end y está documentada en `docs/API.md`.

## Decisión de arquitectura (importante)

- **Distribución elegida: extensión `.mcpb` para Claude Desktop.**
  Cada abogado la instala en su PC y usa **su propia cuenta del SPIJ** para el texto completo.
  Así la carga se reparte entre IPs y no se comparte la suscripción.
- **La web (claude.ai) queda descartada por ahora**: un MCP remoto corre en el servidor y no puede
  usar la sesión ni la IP del abogado. Si algún día se necesita, el Worker debe ir en modo
  "solo metadatos + enlace" (sin credenciales).
- El repo de actualizaciones ya está fijado a `dariodemh/spijmcp` en `src/config.js` y `manifest.json`.
  Si el usuario real de GitHub es otro, cambiar esos dos valores y reconstruir.

## Estado actual

- Funciona contra el SPIJ en vivo. `npm test` pasa (requiere internet y GitHub API).
- 7 herramientas: `buscar_normas`, `buscar_jurisprudencia`, `obtener_documento`, `exportar_documento`, `catalogo_spij`,
  `diagnostico_spij`, `comprobar_actualizacion`.
- Artefactos listos:
  - `dist/spij-mcp-0.2.0.mcpb` (3,2 MB, extensión instalable).
  - `docs/SPIJ-en-Claude-Guia.pdf` (guía de 2 páginas para abogados).
  - `docs/GUIA-USUARIO.md` (guía técnica).
- **El proyecto NO tiene git inicializado todavía** (`git init` pendiente).

## Pendiente — siguiente paso natural

1. Publicar en GitHub:

```powershell
cd "C:\Users\D\Documents\deepseek-harness\default-workspace\spij-mcp"
git init
git add .
git commit -m "SPIJ MCP para abogados"
gh repo create dariodemh/spijmcp --public --source=. --push
git tag v0.1.0
git push --tags
```

El workflow `.github/workflows/release.yml` construye el `.mcpb` y adjunta el PDF y la guía a la release.

2. Verificar la release: descargar el `.mcpb`, instalarlo en Claude Desktop y probar
   `diagnostico_spij` y luego `comprobar_actualizacion` (debe detectar la release).
3. Opcional: firmar el paquete (`mcpb sign dist\spij-mcp-0.2.0.mcpb`) y publicar en npm
   (quitar `"private": true`; el nombre `spij-mcp` estaba libre).

## Comandos

```powershell
npm install              # dependencias
npm test                 # pruebas (SPIJ real + MCP + GitHub)
npm run build:mcpb       # reconstruye dist/spij-mcp-0.2.0.mcpb
node src/server.js       # modo stdio (lo que lanza Claude Desktop)
node src/server.js --http  # modo HTTP con token (MCP_AUTH_TOKEN)
```

## Archivos clave

| Archivo | Rol |
|---|---|
| `src/spij.js` | Cliente de la API del SPIJ: autenticación, búsqueda, detalle, catálogos. |
| `src/tools.js` | Definición de las 7 herramientas MCP y sus esquemas. |
| `src/updates.js` | Comprobación de versiones contra GitHub (cacheada 6 h). |
| `src/config.js` | Versión y repositorio por defecto. |
| `src/server.js` | Entrada stdio/HTTP; comprobación de actualización al arrancar. |
| `src/worker.js` | Variante Cloudflare Workers (no usada en la ruta elegida). |
| `manifest.json` | Manifiesto `.mcpb` (incluye `SPIJ_MCP_REPO`). |
| `scripts/build-mcpb.mjs` | Build multiplataforma del `.mcpb`. |
| `scripts/build-guia.py` | Genera el DOCX de la guía (luego se exporta a PDF). |
| `docs/API.md` | Endpoints del SPIJ, payloads y hallazgos del paywall. |

## Trampas conocidas

- **No mover la carpeta** si se usa la configuración manual de Claude Desktop: apunta a una ruta absoluta.
- El texto completo de jurisprudencia requiere suscripción del SPIJ; el acceso libre da metadatos y sumilla.
  No implementar atajos para saltarse el paywall.
- Los JWT del SPIJ caducan (~24 h); el cliente los renueva solo.
- `comprobar_actualizacion` usa la API de GitHub sin token: 60 peticiones/hora por IP.
- Los tests usan red real (SPIJ y GitHub). En un entorno sin salida a internet fallarán.
- En esta máquina el sandbox de DSH bloquea `child_process` con pipes; en una terminal normal no aplica.
- `recon/` guarda evidencia de la ingeniería inversa (bundle `main.js`, respuestas). Está en `.gitignore`;
  no borrar si se quiere mantener trazabilidad.

## Criterios editoriales

- Todo en español, tono claro para abogados no técnicos.
- Recordar en la documentación: secreto profesional (no pegar datos de clientes), verificar la cita
  original y respetar los términos del SPIJ.
- No afiliar el proyecto al MINJUS.
