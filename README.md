# frase-generator-v2

Sistema automatizado de publicación de contenido para Instagram, Facebook y Threads. Toma frases ingresadas vía formulario web, las renderiza como imágenes con estilo retro 3D, las sube a Cloudinary y las publica en las tres redes. Corre automáticamente dos veces al día vía GitHub Actions.

---

## Cómo funciona

```
ENTRADA          PIPELINE              SERVICIOS EXTERNOS
─────────        ─────────             ──────────────────
formulario  ──►  render                Google Sheets (estado)
  web            upload                Cloudinary (imágenes)
  (GitHub        publish               Instagram API
  Actions)       métricas              Facebook API
                                       Threads API
                                       Telegram (alertas)
```

1. Escribís una frase en `publicar.html` (GitHub Pages)
2. El formulario dispara el workflow `publish.yml` en GitHub Actions
3. El pipeline renderiza → sube → publica en IG, FB y Threads
4. El estado de cada post vive en Google Sheets
5. Los domingos, `metrics.yml` trae métricas de los últimos 30 días
6. Telegram avisa de cada publicación exitosa o error

---

## Uso diario

### Publicar contenido
Abrí `publicar.html` y completá el formulario. Con 1 frase se publica un **single**, con 2-10 frases se publica un **carrusel**.

### Workflows disponibles en GitHub Actions

Entrá a tu repo → pestaña **Actions** → elegí el workflow.

#### `Publish Posts` — el principal
Se dispara solo dos veces al día (10am y 6pm Bogotá), pero también podés correrlo manualmente con estos inputs:

| Input | Para qué | Ejemplo |
|---|---|---|
| `frases` | Frases nuevas separadas por `\|\|` | `la vida es corta\|\|aprovechá cada día` |
| `caption` | Caption del post | `🖤 monacastrosa` |
| `tipo` | Tipo de post | `carousel` o `single` |
| `color` | Color de fondo en hex | `#1a1a2e` (vacío = aleatorio) |
| `solo_registrar` | Guardar sin publicar ahora | `true` |
| `reintentar` | Reintentar posts que fallaron | `true` |
| `publish_only` | Republicar sin re-renderizar | pegar el `row_id` o `carousel_id` del sheet |
| `unlock_id` | Desbloquear una fila atascada | pegar el `row_id` o `carousel_id` del sheet |

#### `Actualizar Métricas` — los domingos
Corre solo los domingos, pero podés lanzarlo manualmente cuando quieras con el input `days` (cuántos días hacia atrás procesar, por defecto 30).

Trae para cada post: views, reach, saves, likes, comments, replies y calcula un `performance_score`.

---

## Qué hacer cuando algo falla

**Telegram te avisó de un error:**
1. Abrí el Google Sheet y buscá la fila con `estado_general = error`
2. Fijate en las columnas `instagram_error`, `facebook_error`, `threads_error` para ver qué plataforma falló
3. Si la imagen ya estaba subida (tiene `media_url`), usá el input `publish_only` con el `row_id` para republicar sin re-renderizar
4. Si falló desde el render, usá `reintentar: true` para que el pipeline lo tome de nuevo

**Una fila quedó bloqueada (`lock_status = locked`):**
- Opción A: esperá ~10 minutos, el sistema la libera automáticamente
- Opción B: en GitHub Actions → `Publish Posts` → Run workflow → campo `unlock_id` → pegá el `row_id` o `carousel_id`

---

## Scripts disponibles

```bash
# Pipeline completo (auto: carousel primero, cae a single si no hay)
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
npm run build:carousel-plan  # genera output/carousel-plan.json y actualiza "plan_carruseles"

# Desarrollo
npm run render                               # preview rápido de una frase
node scripts/dev/render-all-retro-colors.js # previsualiza las 30 paletas

# Sincronizar paletas (después de editar retro-palettes.js)
npm run sync-palettes
npm run check-palettes-sync  # verificar que están sincronizadas

# Diagnóstico rápido
npm run doctor        # valida archivos, exports, sintaxis, docs y paletas
npm run doctor:sheet  # audita columnas y estados del Google Sheet

# Inspiración viral
npm run fetch:inspiration    # llena la pestaña "inspiracion" con candidatos para revisar
npm run import:saved-tweets  # importa data/tweets-guardados-x.txt a la pestaña "archivo_x" (script activo: scripts/jobs/inspiration/import-saved-tweets-to-sheet.js)
npm run curate:archivo-x     # abre la interfaz de curaduría manual en http://localhost:5177 (script activo: scripts/dev/archive-curator-server.js)

# Análisis offline (solo referencia, NO escribe al Sheet)
npm run analyze:phrases-offline -- archivo.txt  # evalúa un .txt local y genera CSVs con scoring
```

### Flujo editorial de archivo_x

El flujo es **100% manual**. Ver referencia técnica completa en [`CLAUDE.md`](CLAUDE.md) — sección "Archivo X (manual curation flow)".

#### 1. Importar frases crudas
```bash
npm run import:saved-tweets
```
Lee `data/tweets-guardados-x.txt`, deduplica y agrega cada frase al Sheet con:
- `decision_editorial = pendiente`
- `grupo_carrusel` vacío
- `frase_final` vacío

No hay scoring automático, no hay clasificación, no hay recomendaciones.

#### 2. Curar frase por frase
```bash
npm run curate:archivo-x
# → http://localhost:5177
```
Interfaz web/móvil para revisar cada frase. Para cada una podés:

| Acción | Efecto |
|---|---|
| Botón **Aprobar** | `decision_editorial = aprobada` |
| Botón **Descartar** | `decision_editorial = descartada` |
| Botón **Pendiente** | `decision_editorial = pendiente` |
| Elegir grupo en sidebar | Asigna `grupo_carrusel` — **no aprueba automáticamente** |
| Editar `frase_final` | Guarda texto corregido — **no aprueba automáticamente** |

Solo las frases con `decision_editorial = aprobada` entran al plan de carruseles.

#### 3. Generar plan de carruseles
```bash
npm run build:carousel-plan
```
Lee **solo** las frases aprobadas, agrupa por `grupo_carrusel`, requiere mínimo 8 por grupo y genera `output/carousel-plan.json`. Para cada frase usa `frase_final` si existe, `frase_original` si no.

#### Columnas principales de `archivo_x`

| Columna | Descripción |
|---|---|
| `decision_editorial` | `pendiente`, `aprobada` o `descartada` — la única decisión que importa |
| `grupo_carrusel` | Uno de los 20 grupos definidos en [`scripts/jobs/inspiration/taxonomy.js`](scripts/jobs/inspiration/taxonomy.js) |
| `frase_final` | Texto corregido o reescrito (opcional) |
| `frase_original` | Texto crudo importado — solo lectura |
| `notas` | Observaciones del curador |
| `temporalidad` | `atemporal`, `temporada`, `coyuntural` o `fecha_especial` |

> Las columnas `sirve`, `estado`, `prioridad`, `calidad`, `riesgo`, `recomendacion_auto` y `clasificado_manual` son **legacy**: se conservan en el Sheet por compatibilidad pero el flujo actual no las usa ni las escribe.

En `plan_carruseles`, revisá principalmente `usar`, `estado`, `revisar`, `grupo`, `orden`, `frase_final` y `notas`.

La lista vigente de grupos está en [`scripts/jobs/inspiration/taxonomy.js`](scripts/jobs/inspiration/taxonomy.js).

---

## Estructura

```
.github/workflows/
  publish.yml          # pipeline principal (2x día + manual)
  metrics.yml          # métricas (domingos + manual)

js/                    # generador visual (frontend / Playwright)
scripts/
  core/                # sheets.js, status.js
  libs/                # graph-client, instagram, facebook, threads,
  |                    # cloudinary, render, telegram
  jobs/                # render, upload, publish — carousel y single
  pipeline/            # run-once, run-carousel, run-single,
  |                    # register-from-form, unlock-row
  utils/               # logger, common, carousel-utils,
                       # render-utils, pipeline-runner, pipeline-utils
  dev/                 # herramientas locales (preview, sync-palettes)

index.html             # generador visual (sirve Playwright para los screenshots)
publicar.html          # formulario de publicación (GitHub Pages)
```

---

## Documentación técnica

| Documento | Contenido |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Mapa completo del sistema: arquitectura, cada capa, modelo de datos, reglas críticas, flujo Archivo X |

---

## Secrets requeridos en GitHub

| Secret | Para qué |
|---|---|
| `SHEET_ID` | ID del Google Sheet de estado |
| `WORKSHEET_NAME` | Nombre de la hoja dentro del sheet |
| `SERVICE_ACCOUNT_JSON` | Credenciales de la cuenta de servicio de Google |
| `CLOUDINARY_CLOUD_NAME` / `API_KEY` / `API_SECRET` | Subida de imágenes |
| `IG_USER_ID` / `IG_ACCESS_TOKEN` | Publicación en Instagram |
| `FB_PAGE_ID` / `FB_PAGE_ACCESS_TOKEN` | Publicación en Facebook |
| `THREADS_USER_ID` / `THREADS_ACCESS_TOKEN` | Publicación en Threads |
| `GRAPH_API_VERSION` | Versión de la Graph API de Meta |
| `GENERATOR_URL` / `GENERATOR_PORT` | URL del servidor de render en Actions |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Notificaciones de éxito y error |
| `X_BEARER_TOKEN` | Opcional: búsqueda reciente de posts en X para inspiración. X puede requerir créditos activos |
| `INSPIRATION_SOURCE` | Opcional: fuentes para inspiración. Ej: `auto`, `x`, `bluesky`, `x,bluesky` |
| `INSPIRATION_QUALITY_MODE` | Opcional: `viral` exige más señal; `explore` permite más descubrimiento. El radar busca amor/ex, plata, trabajo, U, Bogotá/Colombia, WhatsApp, chisme y vida adulta |
| `INSPIRATION_MIN_LIKES` / `INSPIRATION_MIN_SCORE` | Opcional: mínimos de engagement. Defaults en `viral`: `20` likes y `30` score |
| `INSPIRATION_MAX_TEXT_LENGTH` | Opcional: máximo de texto. Default: `150` caracteres |
| `INSPIRATION_DRY_RUN` | Opcional: `true` prueba la búsqueda sin guardar filas |
| `BLUESKY_IDENTIFIER` / `BLUESKY_APP_PASSWORD` | Opcional: fallback autenticado para Bluesky si el endpoint público devuelve 403 |
| `SAVED_TWEETS_INPUT` | Opcional: archivo local para importar al Sheet. Default: `data/tweets-guardados-x.txt` |
| `SAVED_TWEETS_WORKSHEET_NAME` | Opcional: pestaña destino para el archivo de X. Default: `archivo_x` |
| `SAVED_TWEETS_DRY_RUN` | Opcional: `true` evalúa el archivo local sin guardar filas |
| `SAVED_TWEETS_IMPORT_MODE` | ⚠️ Deprecated: ya no tiene efecto en el flujo manual. Se conserva por compatibilidad |