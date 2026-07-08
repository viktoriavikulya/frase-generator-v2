# Entrypoints Del Proyecto

Mapa rapido de que archivo o ruta es activa, historica o solo backend.

## HTML Activo

| Archivo | Rol | Se puede mover? |
| --- | --- | --- |
| `panel.html` | Unica pagina HTML versionada. Panel de trabajo diario en GitHub Pages: Publicar Ahora, Curar Frases, Agregar Frases, Armar Carruseles, Preview y Operaciones. Con `?renderEngine=1` tambien es el motor de render usado por Playwright y por el iframe de preview del propio panel. Entrada oficial: `https://imgifra.github.io/frase-generator-v2/panel.html`. | No. Es el entrypoint de GitHub Pages, el motor de render y un archivo requerido por `scripts/dev/doctor.js`. |

## HTML Eliminados Historicos

- `index.html`: eliminado en la Fase C7B. Era el motor visual/render original. El motor vive ahora en `panel.html?renderEngine=1`. La raiz pelada de GitHub Pages puede dar 404; la URL oficial es `/panel.html`.
- `publicar.html`: eliminado en la Fase C6. La publicacion vive en `panel.html` -> `Publicar Ahora`.
- `tools/archivo-x-curator.html`: eliminado en la Fase C5. Era la UI legacy de curaduria. La ruta `/archivo-x-curator.html` se conserva como redirect del backend de Render hacia `panel.html#curate` cuando aplica, pero el archivo fisico ya no existe.

No describir esos archivos como paginas activas ni recrearlos como entrypoints.

## GitHub Pages Vs Render

- GitHub Pages sirve el panel principal: `panel.html`.
- Render sirve las APIs de curaduria (`/api/phrases`, `/api/raw-phrases`, `/api/plan-carruseles`, `/api/taxonomy`) desde `scripts/dev/archive-curator-server.js`.
- Render puede redirigir rutas legacy hacia `panel.html#curate`; no sirve el panel principal.

## GitHub Actions

`publish.yml` se dispara por:

- `schedule`: `0 15 * * *` y `0 23 * * *`, aprox. 10:00 a.m. y 6:00 p.m. en Colombia.
- `repository_dispatch`: `event_type: publish-posts`, enviado por `panel.html`.

`workflow_dispatch` fue eliminado de `publish.yml`. El formulario manual **Run workflow** ya no es parte del flujo normal.

## Panel Local

En local hacen falta dos procesos:

```bash
npm run curate:archivo-x   # API en http://localhost:5177
npm run panel              # panel en http://localhost:5173/panel.html
```

No abrir `panel.html` con `file://`: las llamadas `fetch` a la API de curaduria fallan por CORS.

## Datos Y Artefactos

| Ruta | Contenido | Notas |
| --- | --- | --- |
| `data/exports/` | Snapshots/exports de Google Sheets y CSV auxiliares. | No son insumos leidos por scripts. |
| `archive/repomix/` | Dumps generados por Repomix para contexto de LLM. | Cubierto por `.gitignore` si se genera la salida esperada. |
| `data/tweets-guardados-x.txt` | Insumo real de `npm run import:saved-tweets`. | Archivo vivo del flujo editorial. |

## Regla General

Antes de mover o renombrar una ruta activa, buscar referencias con `rg`, actualizar docs y correr `npm run doctor`.
