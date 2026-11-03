# API interna del SPIJ (hallazgos)

Documentación de los servicios que consume el front-end Angular del SPIJ y que usa este MCP. **No es una API oficial**: fue reconstruida a partir del bundle `main.ab1423971847644be480.js` del sitio y verificada contra el servicio en vivo el 2026-11-02.

> Trata esto como referencia para mantener el proyecto, no como un contrato. El MINJUS puede cambiarlo sin aviso.

## Hosts

| Servicio | Base | Uso |
|---|---|---|
| Front-end | `https://spij.minjus.gob.pe/spij-ext-web` | SPA Angular (no se usa aquí) |
| Back | `https://spijwsii.minjus.gob.pe/spij-ext-back` | login, catálogos, detalle |
| Solr | `https://spijwsii.minjus.gob.pe/spij-ext-solr` | búsqueda |

Ambos backends son Spring Boot: exponen JSON y responden con el formato `{timestamp,status,error,message,path}` en los errores.

## Autenticación

El sitio tiene tres flujos: usuario suscrito (`api/login`), invitado (`authenticate` con `tipo=0`) y buscador Solr (`/spij-ext-solr/authenticate`).

### 1. Sesión de metadatos (back)

```http
POST /spij-ext-back/authenticate
Content-Type: application/json

{ "usuario": "spijext", "clave": "password", "tipo": "0" }
```

Respuesta:

```json
{ "success": true, "message": "Exitoso", "value": "<JWT>" }
```

- `tipo: "0"` → invitado (acceso libre).
- `tipo: "1"` → suscriptor. El front-end lo usa después de un `api/login` correcto.
- El JWT se usa como `Authorization: Bearer <value>` en `/api/*`.

### 2. Sesión del buscador (Solr)

```http
POST /spij-ext-solr/authenticate
Content-Type: application/json

{ "usuario": "spijext", "clave": "password" }
```

Respuesta: `{ "success": true, "message": "Exitoso", "value": "<JWT>" }`. Es un JWT HS512 con `sub: "spijext"` y `exp` a 24 h.

### 3. Login de suscriptor

```http
POST /spij-ext-back/api/login
Content-Type: application/json

{ "usuario": "<usuario>", "password": "<clave>", "captcha_response": true }
```

Devuelve `{ "token": "<JWT>" }`. Ese token sirve para las validaciones de sesión (`api/validarSesion`, `api/ultimo/registro`), pero **no** para `/api/detallenorma` (el backend lo rechaza con `JWT signature does not match`). Para el detalle se usa el `authenticate` con `tipo=1`.

> Las credenciales `spijext` / `password` viajan en el bundle público del front-end: son la cuenta invitada del botón **ACCESO LIBRE**, no una cuenta de nadie.

## Búsqueda

```http
POST /spij-ext-solr/api/buscar
Authorization: Bearer <token Solr>
Content-Type: application/json
```

### Cuerpo

```json
{
  "filtros": {
    "buscarHistorico": false,
    "busquedaSugerida": false,
    "numeroDispositivoLegal": "",
    "dispositivoLegal": [],
    "tomo": { "id": "", "nombre": "" },
    "materia": { "id": "", "nombre": "" },
    "agrupacion": [],
    "sector": [],
    "subSector": { "id": "", "nombre": "" },
    "orden": "1"
  },
  "facetsSeleccionadas": {
    "fechaPublicacionGap": { "numero": 10, "unidad": "YEAR" }
  },
  "tipoNorma": "NR",
  "textoBusqueda": "contrato",
  "textoSumilla": null,
  "desde": 0,
  "hasta": 10
}
```

Campos:

| Campo | Significado |
|---|---|
| `tipoNorma` | `"NR"` = normas/legislación; `"JR"` = jurisprudencia. |
| `textoBusqueda` | Texto libre (se pasa al índice Solr). `""` = todo. |
| `textoSumilla` | Búsqueda restringida a sumilla (`null` si no se usa). |
| `numeroDispositivoLegal` | Número exacto, ej. `"4322-2026-JNE"`. |
| `filtros.dispositivoLegal` | Lista de tipos: `["LEY"]`, `["CASACION"]`, `["DECRETO SUPREMO"]`, etc. |
| `filtros.sector` | Lista de ids de entidad emisora, ej. `["JNE"]`, `["ENERGIA Y MINAS"]`. |
| `filtros.materia` | `{id, nombre}` de la materia/especialidad (subcategoría del catálogo). |
| `filtros.agrupacion` | Lista de agrupaciones, ej. `["LEGISLACIÓN DE CARACTER GENERAL"]`. |
| `filtros.tomo` | `{id, nombre}` del tomo (catálogo de jurisprudencia). |
| `filtros.buscarHistorico` | `true` para incluir normativa histórica. |
| `desde` / `hasta` | Ventana de paginación (0-based, `hasta` exclusivo). |
| `fechaInicio` / `fechaFin` | Opcionales, formato `AAAA-MM-DD` (a nivel raíz del cuerpo). |

### Respuesta

```json
{
  "totalEncontrados": "42570",
  "desde": "0",
  "hasta": "10",
  "facets": {
    "fechaPublicacion": [{ "total": 5, "nombre": "1910-01-01T00:00:00Z" }],
    "dispositivoLegal": [{ "total": 17701, "nombre": "CASACION" }],
    "sector": [{ "total": 16454, "nombre": " " }]
  },
  "resultados": [
    {
      "id": "H1453514",
      "codigoNorma": "00077-2024-0-0610-JR-CI-01",
      "fechaPublicacion": "2026-10-01",
      "dispositivoLegal": "EXPEDIENTE",
      "sector": null,
      "ruta": "/JURISPRUDENCIA JUDICIAL, ADMINISTRATIVA, SUPRANACIONAL Y CONSTITUCIONAL/JURISPRUDENCIA JUDICIAL/CONSTITUCIONAL /ACCION DE AMPARO /2026/",
      "sumilla": "<h1 class=\"Sumilla\">...</h1>",
      "textoSumilla": "",
      "textoCompleto": "",
      "dispositivoLegalPJ": null,
      "highlights": null,
      "palabra": "",
      "comienzo": ""
    }
  ]
}
```

Notas:

- `totalEncontrados` y `desde`/`hasta` llegan como **strings**; el MCP los convierte a números.
- `sumilla` viene con HTML; el MCP lo limpia.
- `sector` a veces es string, a veces `null` o un objeto `{id, nombre}`; el MCP normaliza.
- `ruta` es la ruta jerárquica del documento y sirve para clasificar (jurisdicción, materia, año).
- `textoCompleto` en la búsqueda viene vacío; el texto se pide al detalle.

### Ejemplos verificados

| Consulta | Total |
|---|---|
| `NR` + `"contrato"` | 42 570 |
| `NR` + texto vacío | 883 061 |
| `JR` + `"contrato"` | 25 592 |
| `JR` + `"casación"` + `dispositivoLegal: ["CASACION"]` | 51 513 |
| `JR` + texto vacío | 97 267 |

## Detalle

```http
GET /spij-ext-back/api/detallenorma/{id}
Authorization: Bearer <token back>
```

Respuesta (jurisprudencia):

```json
{
  "migrado": "0",
  "ruta": "/JURISPRUDENCIA JUDICIAL.../CONSTITUCIONAL /ACCION DE AMPARO /2026/",
  "codigoNorma": "24746-2024",
  "sumilla": "<h1 class=\"Sumilla\">...</h1>",
  "dispositivoLegalPJ": null,
  "titulo": "<Campo no disponible>",
  "comienzo": "...",
  "id": "H1453162",
  "fechaPublicacion": "2026-09-27",
  "sector": null,
  "dispositivoLegal": "EXPEDIENTE",
  "textoCompleto": "<h1 ...>...</h1>"
}
```

### Texto completo: acceso libre vs. suscriptor

La disponibilidad **depende del documento**, no solo del tipo de cuenta:

- Normas recientes (leyes, decretos supremos, ordenanzas, resoluciones) suelen traer `textoCompleto` real ya con la sesión de invitado.
- Jurisprudencia (casaciones, expedientes, sentencias) y documentos antiguos/no migrados devuelven el aviso:

```
Información accesible para suscriptores del SPIJ.
Para informes y suscripciones, escríbenos a: informes.spij@minjus.gob.pe
```

Ejemplos verificados con `tipo=0` (invitado):

| Documento | Texto completo |
|---|---|
| Ley N.º 32743 | disponible |
| Decreto Supremo N.º 227-2026-EF | disponible |
| Ordenanza N.º 026-2026-MPC | disponible |
| Casación 24746-2024 (EXPEDIENTE) | paywall |
| Resolución JNE N.º 4322-2026-JNE | paywall |

El MCP detecta el aviso y lo expone como `texto_disponible: false` + `aviso`. Con una sesión de suscriptor (`tipo=1` previo `api/login` correcto) se espera texto real también en los documentos restringidos; el MCP lo intenta automáticamente cuando configuras `SPIJ_USUARIO` / `SPIJ_CLAVE`.

> No se ha probado el camino de suscriptor por no contar con una cuenta; el flujo implementado replica el del front-end (`api/login` → `authenticate` con `tipo=1`).
## Catálogos

| Endpoint | Contenido |
|---|---|
| `GET /spij-ext-back/api/maestros` | `[ { dispositivolegal: [...], agrupacion: [...], materia: {...}, tomo: [...], sector: [...], constitucion: [...], palabra: [...] } ]` |
| `GET /spij-ext-back/api/agrupamiento` | `[ { agrupamientoNormas: [...] } ]` |
| `GET /spij-ext-back/api/sector` | `[ { sectores: [ {id, nombre, padre, grupo, esPadre} ] } ]` |
| `GET /spij-ext-back/api/detallenorma/{id}` | detalle (ver arriba) |
| `GET /spij-ext-back/api/validarSesion` | validación de sesión (no usada) |
| `GET /spij-ext-back/api/procesarpdf/{id}` | PDF; requiere sesión de suscriptor (404 en pruebas) |

`materia` es un objeto cuyas claves son las 7 agrupaciones de jurisprudencia (JURISPRUDENCIA JUDICIAL, ADMINISTRATIVA, VINCULANTE, PLENOS JURISDICCIONALES, TRIBUNAL CONSTITUCIONAL, CORTE INTERAMERICANA, DICTÁMENES ONU); cada clave contiene las subcategorías válidas para `filtros.materia.id`.

## Reproducir con curl

```bash
TOKEN=$(curl -s -X POST https://spijwsii.minjus.gob.pe/spij-ext-solr/authenticate \
  -H 'Content-Type: application/json' \
  -d '{"usuario":"spijext","clave":"password"}' | jq -r .value)

curl -s -X POST https://spijwsii.minjus.gob.pe/spij-ext-solr/api/buscar \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "filtros": {"buscarHistorico": false, "busquedaSugerida": false,
      "numeroDispositivoLegal": "", "dispositivoLegal": [],
      "tomo": {"id":"","nombre":""}, "materia": {"id":"","nombre":""},
      "agrupacion": [], "sector": [], "subSector": {"id":"","nombre":""},
      "orden": "1"},
    "facetsSeleccionadas": {"fechaPublicacionGap": {"numero":10,"unidad":"YEAR"}},
    "tipoNorma": "JR", "textoBusqueda": "despido arbitrario",
    "textoSumilla": null, "desde": 0, "hasta": 5
  }'
```

En Windows PowerShell, usa `curl.exe` (no el alias `curl` de `Invoke-WebRequest`).

## Notas de mantenimiento

- Los nombres de los endpoints aparecen en `main.*.js`; si cambian, vuelve a descargar el bundle y busca `basePath+`, `baseSolr+` y `authenticate`.
- Los JWT son HS256/HS512; no se validan firmas, solo se lee `exp`.
- El backend de detalle rechaza el token de `api/login`; usa siempre el de `authenticate`.
- Un `500` en `api/buscar` suele deberse a filtros incompatibles (por ejemplo, `materia` de un tipo que no corresponde), no a falta de permisos.
