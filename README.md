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
3. Si la imagen ya estaba subida (tiene `cloudinary_url`), usá el input `publish_only` con el `row_id` para republicar sin re-renderizar
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

# Desarrollo
npm run render                               # preview rápido de una frase
node scripts/dev/render-all-retro-colors.js # previsualiza las 26 paletas

# Sincronizar paletas (después de editar retro-palettes.js)
npm run sync-palettes
npm run check-palettes  # verificar que están sincronizadas
```

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

docs/                  # arquitectura, ejecución local, roadmap
index.html             # generador visual (sirve Playwright para los screenshots)
publicar.html          # formulario de publicación (GitHub Pages)
```

---

## Documentación técnica

| Documento | Contenido |
|---|---|
| [`docs/arquitectura-proyecto.md`](docs/arquitectura-proyecto.md) | Mapa completo del sistema: cada archivo, cada capa, el modelo de datos en Sheets |
| [`docs/AI_CONTRACT.md`](docs/AI_CONTRACT.md) | Guía para IAs o devs que trabajen en el repo: reglas críticas, columnas del sheet, checklist |
| [`docs/orden para ejecucion.txt`](docs/orden%20para%20ejecucion.txt) | Comandos para correr el pipeline localmente en desarrollo |
| [`docs/Qué hacer en el futuro.txt`](docs/Qué%20hacer%20en%20el%20futuro.txt) | Roadmap e ideas pendientes |

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