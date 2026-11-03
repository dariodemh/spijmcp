# Guía de instalación y uso — SPIJ para Claude

Esta extensión permite que Claude busque **normas y jurisprudencia del SPIJ** (Sistema Peruano de Información Jurídica, MINJUS) directamente desde el chat.

Todo se ejecuta **en tu computadora**. No hay servidores intermedios, no se comparte tu cuenta y no hay telemetría.

---

## 1. Lo que necesitas

- **Claude Desktop** para Windows o macOS.
- El archivo **`spij-mcp-X.Y.Z.mcpb`**, descargado desde la página de *Releases* del repositorio:  
  `https://github.com/dariodemh/spijmcp/releases`
- Opcional: tu **usuario y contraseña de suscriptor del SPIJ** (solo si quieres el texto completo de casaciones y sentencias).

No necesitas instalar Node ni nada más: Claude Desktop ya incluye lo necesario.

---

## 2. Instalar

1. Descarga el archivo `.mcpb` de la última release.
2. Abre Claude Desktop.
3. Ve a **Settings → Extensions → Advanced settings → Install Extension…** y elige el archivo descargado.
   - También puedes hacer doble clic sobre el `.mcpb` si tu sistema lo asocia.
4. Si quieres el texto completo, rellena los campos **Usuario del SPIJ** y **Contraseña del SPIJ**. Si no, déjalos vacíos: usarás el acceso libre.
5. Si las herramientas no aparecen, cierra Claude Desktop por completo y vuelve a abrirlo.

---

## 3. Comprobar que funciona

En el chat, pide:

> Ejecuta `diagnostico_spij` y dime el estado.

Debe responder con `"modo": "libre"` (o `"suscriptor"`), la versión instalada y el número de normas y documentos indexados.

Prueba rápida:

> Busca casaciones de 2025 sobre despido arbitrario y dame número, fecha y sumilla.

---

## 4. Qué puedes pedir

- «Busca normas publicadas esta semana sobre contrataciones del Estado.»
- «Encuentra jurisprudencia del Tribunal Constitucional sobre el derecho al agua.»
- «Abre el documento H1453514 y dime si tiene texto completo.»
- «Hazme una tabla con las casaciones laborales de 2026 sobre despido y su sumilla.»

Herramientas disponibles:

| Herramienta | Para qué |
|---|---|
| `buscar_normas` | Leyes, decretos, resoluciones, ordenanzas. |
| `buscar_jurisprudencia` | Casaciones, expedientes, sentencias, resoluciones del TC. |
| `obtener_documento` | Detalle de un documento por su `id`. |
| `exportar_documento` | Guarda el documento en Descargas/SPIJ (Word o PDF original). |
| `catalogo_spij` | Valores válidos para filtrar (sectores, materias, tipos). |
| `diagnostico_spij` | Estado de la conexión y versión instalada. |
| `comprobar_actualizacion` | Ver si hay una versión nueva de la extensión. |

---

## 5. Actualizaciones

La extensión **puede comprobar si hay versiones nuevas**. Pregunta en el chat:

> ¿Hay alguna actualización del conector del SPIJ?

Claude llamará a `comprobar_actualizacion`, que consulta las *releases* del repositorio y responde con:

- la versión instalada y la última publicada,
- si hay actualización,
- el enlace de descarga del nuevo `.mcpb`.

Para actualizar:

1. Descarga el `.mcpb` nuevo desde el enlace.
2. Instálalo igual que la primera vez (**Settings → Extensions → Install Extension…**).
3. La versión anterior se reemplaza; no pierdes la configuración de usuario y contraseña.

> Si `comprobar_actualizacion` responde que **no está configurada**, quien publicó la extensión no indicó el repositorio (`SPIJ_MCP_REPO`). En ese caso, revisa manualmente la página de Releases.

---

## 6. Privacidad y seguridad

- Las consultas van **directamente de tu PC al SPIJ** (`spijwsii.minjus.gob.pe`). No pasan por servidores de terceros.
- Tu usuario y contraseña los guarda Claude Desktop y solo se usan para iniciar sesión en el SPIJ.
- La comprobación de actualizaciones solo consulta `api.github.com` y no envía datos personales.
- La extensión **no elude la suscripción**: usa el acceso libre que ofrece el propio SPIJ o tu propia cuenta.
- El cliente espacia las peticiones para no saturar el servicio. Evita usarlo para descargas masivas.

---

## 7. Problemas comunes

| Problema | Solución |
|---|---|
| No aparece en la lista de extensiones | Verifica que tu Claude Desktop sea reciente; reinstala el `.mcpb`; reinicia la app. |
| Error 401/403 al buscar | Sesión caducada o red bloqueada; espera un minuto y reintenta. |
| Timeout o «no se pudo conectar» | Posible bloqueo geográfico del SPIJ; prueba sin VPN o desde otra red. |
| `"texto_disponible": false` | Ese documento está reservado a suscriptores; configura tu cuenta. |
| No encuentra resultados | Prueba con menos filtros o sin comillas; el buscador usa el índice del SPIJ. |
| «No está configurada» al comprobar actualizaciones | El publicador no definió `SPIJ_MCP_REPO`. Consulta las releases manualmente. |

---

## 8. Desinstalar

**Settings → Extensions → SPIJ Perú → Uninstall**. No deja archivos ni datos en el SPIJ.
