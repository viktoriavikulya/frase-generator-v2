# frase-generator-v2

Sistema automatizado de publicacion para Instagram, Facebook y Threads. El panel oficial vive en GitHub Pages:

https://imgifra.github.io/frase-generator-v2/panel.html

`panel.html` es el unico HTML versionado. Tambien contiene el motor de render cuando se abre como `panel.html?renderEngine=1`; Playwright usa esa URL para generar los PNG de produccion.

## Como Funciona

1. El usuario opera desde `panel.html`.
2. El panel dispara GitHub Actions con `repository_dispatch`.
3. `publish.yml` registra frases, renderiza, sube a Cloudinary y publica en Instagram, Facebook y Threads.
4. Google Sheets guarda todo el estado del pipeline.
5. Telegram avisa exitos y errores.
6. `metrics.yml` trae metricas los domingos.

`publish.yml` se dispara por:
- `schedule`: `0 15 * * *` y `0 23 * * *`, aprox. 10:00 a.m. y 6:00 p.m. en Colombia.
- `repository_dispatch`: `event_type: publish-posts`, enviado por el panel.

Ya no existe `workflow_dispatch` en `publish.yml`. El formulario manual **Run workflow** fue eliminado; GitHub Actions queda como vista de seguimiento/debug, no como interfaz principal de operacion.

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
- abrir GitHub Actions
- abrir el run recien disparado

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

El token de GitHub se escribe en el campo **Token de GitHub** del panel. No se guarda en `localStorage`, no debe versionarse y no debe ponerse en archivos. Para `repository_dispatch`, un fine-grained PAT necesita permiso `Contents: write` sobre este repo; un classic PAT necesita scope `repo`.

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
  publish.yml          # schedule + repository_dispatch
  metrics.yml          # metricas dominicales + trigger manual propio

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
- `v-panel-repository-dispatch-stable`: estado final con `repository_dispatch` y sin `workflow_dispatch`.

## Que No Hacer

- No usar `file://` para abrir el panel.
- No editar secrets en frontend.
- No volver a crear `index.html`, `publicar.html` ni `tools/archivo-x-curator.html` como entrypoints.
- No usar **Run workflow** manual como flujo normal.
- No tocar `publish.yml` sin correr `npm run doctor` y probar `repository_dispatch`.

## Documentacion Tecnica

| Documento | Contenido |
|---|---|
| [`docs/README.md`](docs/README.md) | Indice de documentacion |
| [`CLAUDE.md`](CLAUDE.md) | Mapa completo del sistema y reglas criticas |
| [`docs/architecture/entrypoints.md`](docs/architecture/entrypoints.md) | Entrypoints activos e historicos |
| [`docs/architecture/mapa-del-proyecto.md`](docs/architecture/mapa-del-proyecto.md) | Mapa visual y checklist de riesgos |
| [`docs/operations/scripts.md`](docs/operations/scripts.md) | Inventario de comandos |
