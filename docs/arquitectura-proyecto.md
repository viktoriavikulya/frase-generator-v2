# Mapa del Proyecto: frase-generator-v2

## Qué hace el proyecto

Sistema automatizado de publicación de contenido para Instagram, Facebook y Threads. Toma frases (ingresadas manualmente vía formulario web), las renderiza como imágenes con estilo retro 3D, las sube a Cloudinary y las publica en las tres redes sociales. Corre 2 veces al día vía GitHub Actions.

---

## Capas del sistema

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

---

## 1. Entrada: `publicar.html`

Formulario web estático alojado en GitHub Pages. Permite:
- Escribir frases (1 = single, 2-10 = carousel)
- Escribir caption
- Elegir color de fondo (26 opciones + aleatorio)
- Publicar ahora o solo guardar en sheet

**Cómo funciona:** hace un POST a la API de GitHub para disparar el workflow `publish.yml` con los inputs del formulario.

**No tiene backend propio** — todo lo maneja GitHub Actions.

---

## 2. Orquestación: `.github/workflows/publish.yml`

El corazón del sistema. Se dispara de tres formas:

| Trigger | Cuándo | Qué hace |
|---|---|---|
| `schedule` | 10am, 6pm Bogotá | Publica automáticamente lo que haya pendiente |
| `workflow_dispatch` (con frases) | Al enviar el formulario | Registra frases y publica |
| `workflow_dispatch` (manual) | Desde GitHub Actions | Reintentar / publish-only / unlock |

**Inputs manuales disponibles:**

| Input | Para qué |
|---|---|
| `frases` | Frases nuevas (separadas por `\|\|`) |
| `caption` | Caption del post |
| `tipo` | `carousel` / `single` |
| `color` | Color hex (vacío = aleatorio) |
| `solo_registrar` | Guardar sin publicar |
| `reintentar` | Reintentar posts en error |
| `publish_only` | Republicar sin re-renderizar (pasar `row_id` o `carousel_id`) |
| `unlock_id` | Desbloquear fila atascada inmediatamente (pasar `row_id` o `carousel_id`) |

**Steps en orden:**
1. Checkout + setup Node.js
2. Instalar dependencias + Playwright (Chromium)
3. `unlock-row.js` — si viene `unlock_id`, desbloquea la fila y termina
4. `register-from-form.js` — si vienen frases del formulario, las escribe al sheet
5. `run-once.js` — ejecuta el pipeline según el modo
6. `fetch-metrics.js` — solo los domingos, actualiza métricas de los últimos 30 días

---

## 3. Registro: `scripts/pipeline/register-from-form.js`

Recibe las frases del formulario vía variables de entorno y las escribe al Google Sheet como filas `pending`.

- Lee: `FRASES_INPUT`, `CAPTION_INPUT`, `TIPO_INPUT`, `COLOR_INPUT`
- Genera un `row_id` único con `crypto.randomUUID()` por cada fila
- Genera un `carousel_id` único (`car_` + 12 chars) si es carrusel
- Escribe al sheet: estado `pending` en todas las columnas de estado
- Exporta `TARGET_CAROUSEL_ID` o `TARGET_ROW_NUMBER` al entorno de GitHub para que el siguiente step lo use

---

## 4. Desbloqueo manual: `scripts/pipeline/unlock-row.js`

Libera inmediatamente una fila atascada en `lock_status = locked` o `estado_general = processing`.

- Lee: `UNLOCK_ID` (puede ser `row_id` para singles o `carousel_id` para carruseles)
- Detecta en qué paso estaba atascada
- Escribe: `lock_status = free`, `estado_general = error`, mensaje en `error_message`
- Notifica por Telegram que la fila fue liberada y que el próximo ciclo la reintentará

**Cuándo usarlo:** si un job de GitHub Actions fue cancelado o expiró y la fila quedó bloqueada. Alternativa: esperar ~10 minutos a que `releaseStaleLocks` la detecte automáticamente al inicio del siguiente ciclo.

---

## 5. Orquestador principal: `scripts/pipeline/run-once.js`

Decide qué tipo de pipeline correr según `TIPO_INPUT`:

| Valor | Comportamiento |
|---|---|
| `carousel` | Solo procesa carruseles |
| `single` | Solo procesa singles |
| `auto` (defecto) | Intenta carousel primero, si no hay cae a single |

También soporta modo `publish-only`: saltea render y upload, va directo a publicar una fila específica.

Después de cualquier fallo, lee las columnas `instagram_error`, `facebook_error`, `threads_error` del sheet y las incluye en la notificación de Telegram para identificar exactamente qué plataforma falló.

---

## 6. Pipelines: `run-carousel.js` y `run-single.js`

Ambos llaman a `pipeline-runner.js` con la configuración de sus scripts. El flujo es el mismo para los dos tipos:

```
En modo schedule:
  1. Intentar publicar pendientes del ciclo anterior
  2. Intentar subir pendientes ya renderizados
  3. Render → Upload → Publish

En modo formulario (form):
  1. Render → Upload → Publish (sin intentar publicar pendientes)
```

---

## 7. Jobs individuales

### Render
| Archivo | Qué hace |
|---|---|
| `render-carousel-from-sheet.js` | Lee filas pending del sheet, renderiza cada slide con Playwright, guarda PNG en `/output` |
| `render-single-from-sheet.js` | Igual pero para una sola imagen |

**Color:** usa el `background_color` del sheet si viene del formulario; si no, elige uno aleatorio diferente al último publicado.

**Render engine:** levanta un servidor HTTP local que sirve el generador web (`index.html`), abre Playwright, navega a `/?text=...&mode=retro3d&bg=...` y hace screenshot. El servidor maneja `SIGTERM` y `SIGINT` para cerrar limpiamente si GitHub Actions cancela el job.

### Upload
| Archivo | Qué hace |
|---|---|
| `upload-carousel-from-sheet.js` | Sube cada PNG a Cloudinary, guarda la URL en el sheet, borra el archivo local |
| `upload-single-from-sheet.js` | Igual para un solo archivo |

### Publish
| Archivo | Qué hace |
|---|---|
| `publish-carousel-from-sheet.js` | Lee URLs de Cloudinary del sheet, publica en IG, FB y Threads, borra assets de Cloudinary |
| `publish-single-from-sheet.js` | Igual para post single |

---

## 8. Métricas: `scripts/jobs/metrics/fetch-metrics.js`

Corre los domingos. Para cada post publicado en los últimos 30 días:
1. Llama a `/{mediaId}/insights` de la Graph API
2. Trae: views, reach, saves, likes, comments
3. Calcula `engagement_rate` y `performance_score` (saves×3 + comments×2 + likes / reach)
4. Escribe de vuelta al sheet

---

## 9. Librerías compartidas: `scripts/libs/`

| Archivo | Responsabilidad |
|---|---|
| `graph-client.js` | Base compartida: `graphGet`, `graphPost`, `buildGraphErrorMessage` |
| `instagram-lib.js` | Publica en Instagram: containers, polling, carousels. Usa graph-client + manejo de tokens |
| `facebook-lib.js` | Publica en Facebook: fotos, carrusels. Usa graph-client + retry automático |
| `threads-lib.js` | Publica en Threads: image + carousel. Retry automático en errores transitorios (5xx, código 1) |
| `render-lib.js` | Levanta servidor HTTP local + Playwright para renderizar imágenes. Maneja SIGTERM/SIGINT |
| `upload-lib.js` | Sube y borra archivos en Cloudinary |
| `telegram-lib.js` | Notificaciones al bot de Telegram. `notifyError` incluye errores por plataforma |
| `retro-palettes.js` | FUENTE DE VERDAD de las 26 paletas. Nunca editar `js/palettes.js` directamente |

---

## 10. Core: `scripts/core/`

| Archivo | Responsabilidad |
|---|---|
| `sheets.js` | Cliente de Google Sheets: leer filas, escribir celdas en batch |
| `status.js` | Constantes del sistema: estados, tipos, locks, paletas |

---

## 11. Utils: `scripts/utils/`

| Archivo | Responsabilidad |
|---|---|
| `pipeline-runner.js` | Ejecuta los steps render→upload→publish en orden, maneja errores |
| `pipeline-utils.js` | `runStep`: ejecuta un script hijo con timeout de 4 minutos |
| `carousel-utils.js` | Helpers para agrupar filas del sheet por `carousel_id` |
| `common.js` | `nowIsoLocal()` y otros helpers de fecha/string |
| `logger.js` | Logger estructurado JSON con contexto (cycleId, job, etc.) |

---

## 12. Generador visual: `js/` + `index.html`

App web estática que renderiza las frases. Es lo que Playwright abre para hacer los screenshots.

| Archivo | Responsabilidad |
|---|---|
| `mode-retro3d.js` | Modo activo: efecto 3D retro con sombras y colores neón |
| `mode-brat.js` | Modo anterior (ya no se usa en producción) |
| `mode-normal.js` | Modo básico |
| `palettes.js` | Paletas de color del frontend (espejo de `retro-palettes.js`) |
| `config.js` | Configuración del generador |
| `branding.js` | Marca de agua / logo |
| `app.js` | Orquesta los modos, escucha `window.renderReady` |

---

## 13. Estado en Google Sheets

Cada fila del sheet es un post (o un slide de carrusel). Las columnas clave:

| Columna | Qué guarda |
|---|---|
| `row_id` | UUID único e inmutable por fila — generado con `crypto.randomUUID()` |
| `frase_original` / `frase_corregida` | El texto |
| `post_tipo` | `single` o `carousel` |
| `carousel_id` | ID compartido por todos los slides del mismo carrusel (`car_` + 12 chars) |
| `carousel_order` | Posición del slide dentro del carrusel |
| `estado_general` | `pending` → `processing` → `published` / `error` |
| `estado_render` / `estado_upload` / `estado_publish` | Estado de cada paso |
| `lock_status` | `free` / `locked` — evita que dos ciclos procesen la misma fila |
| `background_color` | Color hex usado |
| `output_file` | Nombre del PNG generado |
| `media_url` | URL pública de la imagen subida a Cloudinary |
| `cloudinary_public_id` | ID del asset en Cloudinary, usado para borrarlo después de publicar |
| `instagram_media_id` | ID del post en IG |
| `instagram_error` / `facebook_error` / `threads_error` | Error específico por plataforma del último intento |
| `likes`, `saves`, `reach`, `views` | Métricas |
| `performance_score` | Score calculado (saves×3 + comments×2 + likes) / reach |
| `updated_at` | ISO 8601 — usado por `releaseStaleLocks` para detectar filas viejas |

---

## 14. Integraciones externas

| Servicio | Cómo se conecta | Secret en GitHub |
|---|---|---|
| Google Sheets | Service Account JSON | `SERVICE_ACCOUNT_JSON` |
| Cloudinary | API Key + Secret | `CLOUDINARY_*` |
| Instagram | Token permanente (usuario del sistema Meta) | `IG_ACCESS_TOKEN` |
| Facebook | Page Token (usuario del sistema Meta) | `FB_PAGE_ACCESS_TOKEN` |
| Threads | Token de usuario | `THREADS_ACCESS_TOKEN` |
| Telegram | Bot token + Chat ID | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| GitHub Actions | Token del formulario (scope: workflow) | ingresado manualmente en el form |

---

## Flujo completo de un post (desde el formulario)

```
publicar.html
  │  POST a GitHub API con frases + caption + color
  ▼
publish.yml (workflow_dispatch)
  │
  ├─ register-from-form.js
  │    Lee FRASES_INPUT, escribe filas pending al sheet
  │    Genera row_id con crypto.randomUUID() por cada fila
  │    Exporta TARGET_CAROUSEL_ID al entorno
  │
  └─ run-once.js (FORM_MODE)
       │
       ├─ render-carousel-from-sheet.js
       │    Lee sheet → abre Playwright → screenshot × N slides
       │    Escribe output_file + background_color al sheet
       │
       ├─ upload-carousel-from-sheet.js
       │    Lee output_file → sube a Cloudinary → escribe URL al sheet
       │    Borra PNG local
       │
       └─ publish-carousel-from-sheet.js
            Lee URLs de Cloudinary
            → Instagram API (containers + polling + publish)
            → Facebook API (fotos no publicadas + feed post)
            → Threads API (containers + publish, con retry automático)
            Escribe media IDs al sheet
            Borra assets de Cloudinary
            Marca filas como published
            Si falla alguna plataforma → escribe en instagram_error/facebook_error/threads_error
```
