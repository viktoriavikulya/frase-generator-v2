# frase-generator-v2

Sistema automatizado de publicacion para Instagram, Facebook y Threads. El panel oficial vive en GitHub Pages:

https://imgifra.github.io/frase-generator-v2/panel.html

`panel.html` es el unico HTML versionado. Tambien contiene el motor de render cuando se abre como `panel.html?renderEngine=1`; Playwright usa esa URL para generar los PNG de produccion. Los `onload` de watermark/logo en `js/config.js` tienen un guard antes de llamar `draw()` (que define `js/app.js` mas tarde en la cadena de carga), asi que la consola ya no muestra el viejo `ReferenceError: draw is not defined`; el render final no cambia.

## Como Funciona

1. El usuario opera desde `panel.html`.
2. El panel dispara GitHub Actions con `repository_dispatch`.
3. `publish.yml` registra frases, renderiza, sube a Cloudinary y publica en Instagram, Facebook y Threads.
4. Google Sheets guarda todo el estado del pipeline.
5. Telegram avisa exitos y errores.
6. `metrics.yml` trae metricas los domingos y tambien se dispara a demanda desde **Operaciones**.

`publish.yml` se dispara por:
- `schedule`: `0 15 * * *` y `0 23 * * *`, aprox. 10:00 a.m. y 6:00 p.m. en Colombia.
- `repository_dispatch`: `event_type: publish-posts`, enviado por el panel.

`metrics.yml` se dispara por:
- `schedule`: `0 15 * * 0`, aprox. domingo 10:00 a.m. en Colombia.
- `repository_dispatch`: `event_type: update-metrics`, enviado por el panel desde **Operaciones**.

Ya no existe `workflow_dispatch` ni en `publish.yml` ni en `metrics.yml`. El formulario manual **Run workflow** fue eliminado en ambos; GitHub Actions sigue siendo el motor y el registro de ejecucion, pero la operacion normal se hace desde `panel.html#operations` (Publish Posts, Actualizar Metricas y el seguimiento basico via Historial de ejecuciones).

## Panel

Entrada oficial:

```text
https://imgifra.github.io/frase-generator-v2/panel.html
```

Pestanas actuales:
- Publicar Ahora
- Curar Frases
- Agregar Frases
- Armar Carruseles
- Preview
- Operaciones

### Publicar

Desde **Publicar Ahora**:
- 1 frase crea un single.
- 2 a 10 frases crean un carrusel.
- Guardar en Sheet registra contenido sin publicarlo inmediatamente.

### Operaciones

La pestana **Operaciones** permite:
- reintentar posts en error
- republicar sin re-renderizar por `row_id` o `carousel_id`
- desbloquear una fila atascada
- actualizar metricas (campo `Dias a consultar`, default 30, rango 1 a 365)
- consultar el historial de ejecuciones (ultimos runs de `publish.yml` y `metrics.yml`)
- abrir los workflows y runs en GitHub Actions (incluido el run recien disparado)

## Dispatch Del Pipeline

El panel usa:

```http
POST https://api.github.com/repos/imgifra/frase-generator-v2/dispatches
```

Payload:

```json
{
  "event_type": "publish-posts",
  "client_payload": {
    "frases": "",
    "caption": "",
    "tipo": "auto",
    "solo_registrar": "false",
    "reintentar": "false",
    "color": "",
    "publish_only": "",
    "unlock_id": "",
    "target_carousel_id": ""
  }
}
```

### Actualizar Metricas

Desde **Operaciones**, el boton `Actualizar metricas ahora` usa el mismo endpoint de dispatches con:

```json
{
  "event_type": "update-metrics",
  "client_payload": {
    "days": "30"
  }
}
```

`days` sale del campo `Dias a consultar` (default `30`, rango 1 a 365). `metrics.yml` lo lee con `METRICS_DAYS: ${{ github.event.client_payload.days || '30' }}`.

### Historial De Ejecuciones

El boton `Actualizar historial` de **Operaciones** lista hasta 10 ejecuciones recientes mezcladas de `publish.yml` (Publish Posts) y `metrics.yml` (Actualizar Metricas), leyendo:

```http
GET https://api.github.com/repos/imgifra/frase-generator-v2/actions/workflows/{workflow}/runs?per_page=5
```

Por cada run muestra workflow, status/conclusion, event, branch, SHA corto, fechas y el enlace `Abrir run`. No filtra por `event` ni `branch`, para incluir `repository_dispatch`, `schedule` e historicos — por eso puede aparecer algun `workflow_dispatch` viejo aunque ese trigger ya no exista en los workflows. Exige el token de GitHub del panel.

Los errores de la API de GitHub en **Operaciones** tienen manejo unificado (dispatch e historial): 401 se reporta como token invalido o vencido; 403 distingue cuando es posible entre limite de la API (rate limit) y permisos insuficientes; 404 indica que el token no tiene acceso al repositorio o que el recurso no existe. Si al consultar el historial falla solo uno de los dos workflows, el panel muestra igualmente los runs del que respondio, mas una advertencia indicando cual no se pudo consultar.

El token de GitHub se escribe en el campo **Token de GitHub** del panel. No se guarda en `localStorage`, no debe versionarse y no debe ponerse en archivos. Para `repository_dispatch`, un fine-grained PAT necesita permiso `Contents: write` sobre este repo; un classic PAT necesita scope `repo`. El mismo token sirve para disparar Publish Posts (`publish-posts`) y Actualizar Metricas (`update-metrics`). Para leer el historial de ejecuciones, un fine-grained PAT necesita ademas `Actions: read`; el scope `repo` de un classic PAT ya cubre esa lectura.

## Panel Local

Para probar el panel en local se usan dos procesos:

```bash
# Terminal 1: API de Archivo X
npm run curate:archivo-x
# http://localhost:5177

# Terminal 2: panel
npm run panel
# http://localhost:5173/panel.html
```

No abrir `panel.html` con doble clic ni con `file://`; el panel hace `fetch` hacia la API del curador y esas llamadas fallan desde origen `file://`.

## Flujo Operativo Recomendado

- Publicar: `Publicar Ahora`.
- Guardar sin publicar: `Publicar Ahora` -> guardar en Sheet.
- Reintentar errores: `Operaciones` -> `Reintentar ahora`.
- Republicar sin re-renderizar: `Operaciones` -> pegar `row_id` o `carousel_id`.
- Desbloquear: `Operaciones` -> pegar ID y confirmar.
- Actualizar metricas: `Operaciones` -> `Actualizar metricas ahora`.
- Ver historial de ejecuciones: `Operaciones` -> `Actualizar historial`.
- Ver ejecucion: abrir el run desde el enlace del panel.

## Cuando Algo Falla

Si Telegram avisa de un error:

1. Abrir el Google Sheet y buscar la fila con `estado_general = error`.
2. Revisar `instagram_error`, `facebook_error` y `threads_error`.
3. Si ya hay `media_url`, usar **Operaciones** para republicar sin re-renderizar.
4. Si fallo antes, usar **Operaciones** -> `Reintentar ahora`.

Si una fila queda con `lock_status = locked`:
- esperar unos 10 minutos para que `releaseStaleLocks` la libere, o
- usar **Operaciones** -> desbloquear fila.

## Archivo X

El flujo editorial es 100% manual:

1. Importar frases crudas con `npm run import:saved-tweets` o pegarlas en **Agregar Frases**.
2. Curar frase por frase en **Curar Frases**.
3. Armar carruseles en **Armar Carruseles**.

Solo las frases con `decision_editorial = aprobada` entran al armado de carruseles.

**Agregar Frases** tambien acepta pantallazos: se pueden subir, arrastrar o pegar (Ctrl+V) hasta 5 imagenes PNG/JPG/WebP de maximo 10 MB, y un OCR local (tesseract.js vendoreado en `vendor/tesseract/`, versiones pineadas en su `VERSIONS.txt`) las convierte en frases candidatas editables. Todo corre en el navegador: las imagenes no se envian a ninguna API externa, no se guardan y no hay claves de OCR/IA. El OCR se carga solo al usar ese bloque. Las candidatas dudosas aparecen desmarcadas; "Agregar seleccionadas al texto" solo llena el textarea, y guardar sigue siendo el boton normal de **Guardar frases** (mismo `POST /api/raw-phrases`, mismas frases `pendientes` en Curar Frases). Si el OCR falla o el navegador es viejo (el core WASM SIMD requiere Chrome 91+/Firefox 89+/Safari 16.4+), el pegado manual de texto sigue funcionando igual. La calidad del OCR varia con fondos ruidosos, tipografias decorativas o texto pequeno — por eso siempre hay revision manual antes de agregar. No reemplazar `vendor/tesseract/` por un CDN sin decision explicita.

Render sigue sirviendo las APIs de curaduria (`/api/phrases`, `/api/raw-phrases`, `/api/plan-carruseles`, `/api/taxonomy`) y redirige rutas legacy hacia `panel.html#curate` cuando aplica. Render no sirve el panel principal; el panel principal esta en GitHub Pages.

## Scripts

```bash
# Pipeline completo local
node scripts/pipeline/run-once.js

# Solo un tipo
TIPO_INPUT=carousel node scripts/pipeline/run-once.js
TIPO_INPUT=single   node scripts/pipeline/run-once.js

# Jobs individuales
npm run render:single
npm run render:carousel
npm run upload:single
npm run upload:carousel
npm run publish:single
npm run publish:carousel

# Desarrollo
npm run render
npm run panel
npm run curate:archivo-x

# Diagnostico
npm run doctor
npm run doctor:sheet
```

`npm run doctor` valida archivos, exports, sintaxis, docs y paletas. Correlo antes de tocar piezas del pipeline.

## Estructura

```text
.github/workflows/
  publish.yml          # schedule + repository_dispatch (publish-posts)
  metrics.yml          # schedule dominical + repository_dispatch (update-metrics)

panel.html             # unico HTML versionado; panel y motor ?renderEngine=1
js/                    # generador visual usado por Playwright
scripts/               # pipeline, jobs, libs, utilidades y API de curaduria
docs/                  # documentacion tecnica y operativa
```

HTML eliminados/historicos:
- `index.html`
- `publicar.html`
- `tools/archivo-x-curator.html`

No describirlos como paginas activas ni recrearlos como entrypoints.

## Playwright

El workflow usa Playwright Chromium con cache. Ya no instala `chromium-browser` por apt/snap.

## Puntos De Restauracion

- `v-panel-unico-stable`: arquitectura de panel unico.
- `v-panel-operations-stable`: panel unico + pestana Operaciones.
- `v-panel-repository-dispatch-stable`: `publish.yml` con `repository_dispatch` y sin `workflow_dispatch`.
- `v-panel-repository-dispatch-docs`: estado documentado previo (docs alineadas a `repository_dispatch`).
- `v-panel-operations-metrics-stable`: metricas operadas desde Operaciones y `metrics.yml` sin `workflow_dispatch`.
- `v-panel-operations-history-stable`: estado con Historial de ejecuciones en Operaciones.
- `v-panel-operations-hardening-stable`: manejo unificado de errores de GitHub API en Operaciones (mensajes claros para 401/403/404 e historial parcial si un workflow falla).
- `v-render-engine-draw-guard-stable`: motor de render sin el `ReferenceError: draw is not defined` preexistente (guards en los onload de assets de `js/config.js`).
- `v-panel-raw-ocr-stable`: OCR local de pantallazos en Agregar Frases (tesseract.js vendoreado, candidatas con revision manual, sin auto-guardado).

## Que No Hacer

- No usar `file://` para abrir el panel.
- No editar secrets en frontend.
- No volver a crear `index.html`, `publicar.html` ni `tools/archivo-x-curator.html` como entrypoints.
- No usar **Run workflow** manual como flujo normal (ya no existe ni en `publish.yml` ni en `metrics.yml`); publicar y actualizar metricas desde **Operaciones**.
- No tocar `publish.yml` ni `metrics.yml` sin correr `npm run doctor` y probar `repository_dispatch`.

## Documentacion Tecnica

| Documento | Contenido |
|---|---|
| [`docs/README.md`](docs/README.md) | Indice de documentacion |
| [`CLAUDE.md`](CLAUDE.md) | Mapa completo del sistema y reglas criticas |
| [`docs/architecture/entrypoints.md`](docs/architecture/entrypoints.md) | Entrypoints activos e historicos |
| [`docs/architecture/mapa-del-proyecto.md`](docs/architecture/mapa-del-proyecto.md) | Mapa visual y checklist de riesgos |
| [`docs/operations/scripts.md`](docs/operations/scripts.md) | Inventario de comandos |
