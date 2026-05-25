# AI_CONTRACT.md — frase-generator-v2

Guía para cualquier IA (o humano) que trabaje en este repositorio.
Léela completa antes de tocar código.

---

## Qué hace este proyecto

Sistema automatizado de publicación de contenido para Instagram, Facebook y Threads.
Toma frases escritas manualmente, las renderiza como imágenes estilo retro 3D con Playwright,
las sube a Cloudinary y las publica en las tres plataformas. Corre 2 veces al día vía GitHub Actions.

**Stack:** Node.js · Google Sheets (estado) · Cloudinary (imágenes) · Meta Graph API · Playwright

---

## Arquitectura en una línea

```
publicar.html → GitHub Actions → register → render → upload → publish → métricas
```

Cada flecha es un script independiente. El estado viaja a través de Google Sheets.

---

## Estructura del repo

```
/
├── js/                        Frontend del generador visual (corre en Playwright)
│   ├── app.js                 Orquesta modos; setea window.renderReady = true al terminar
│   ├── palettes.js            Paletas de color — ESPEJO de retro-palettes.js (ver abajo)
│   ├── mode-retro3d.js        Modo activo de render
│   └── utils.js               Helpers visuales (getBrightness, getContrastColor, hexToRgb...)
│
├── scripts/
│   ├── auth/                  google-auth.js — service account
│   ├── core/
│   │   ├── sheets.js          Cliente Google Sheets (readRows, updateCellsBatch)
│   │   └── status.js          Constantes: STATUS, LOCK_STATUS, POST_TIPOS, MAX_INTENTOS
│   ├── libs/
│   │   ├── graph-client.js    Base HTTP para Meta API (graphGet, graphPost — soporta arrays)
│   │   ├── instagram-lib.js   Publica en IG: containers, polling, carousels
│   │   ├── facebook-lib.js    Publica en FB: fotos + carrusels con retry
│   │   ├── threads-lib.js     Publica en Threads: image + carousel, con retry automático
│   │   ├── render-lib.js      Servidor HTTP local + Playwright (maneja SIGTERM/SIGINT)
│   │   ├── upload-lib.js      Sube/borra en Cloudinary
│   │   ├── telegram-lib.js    Notificaciones al bot de Telegram (incluye errores por plataforma)
│   │   └── retro-palettes.js  FUENTE DE VERDAD de las paletas (ver regla #4)
│   ├── jobs/
│   │   ├── single/            render/upload/publish/apply-plan para posts únicos
│   │   ├── carousel/          render/upload/publish/apply-plan para carruseles
│   │   └── metrics/           fetch-metrics.js — corre los domingos
│   ├── pipeline/
│   │   ├── run-once.js        Punto de entrada: decide single/carousel/auto/publish-only + releaseStaleLocks
│   │   ├── run-single.js      Pipeline de single
│   │   ├── run-carousel.js    Pipeline de carousel
│   │   ├── register-from-form.js  Escribe frases del formulario al sheet (genera row_id con randomUUID)
│   │   └── unlock-row.js      Desbloquea manualmente una fila atascada (lock_status → free)
│   ├── utils/
│   │   ├── pipeline-runner.js Ejecuta steps render→upload→publish en orden
│   │   ├── pipeline-utils.js  runStep (timeout 4min) + releaseStaleLocks + buildStepEnv
│   │   ├── carousel-utils.js  Agrupa filas del sheet por carousel_id
│   │   ├── common.js          nowIsoLocal(), colToLetter(), normalizeValue()
│   │   └── logger.js          Logger estructurado JSON
│   └── dev/
│       ├── sync-palettes.js         Fuente → frontend (CORRER después de editar paletas)
│       └── check-palettes-sync.js   Verifica sincronización (usar en CI)
│
├── data/
│   └── singles-plan.json      Plan de publicación — datos separados del código
│
└── docs/
    ├── arquitectura-proyecto.md   Mapa completo del sistema
    └── AI_CONTRACT.md             Este archivo
```

---

## El sheet de Google Sheets — columnas clave

Cada fila es un post (o un slide de carrusel).

| Columna | Valores posibles | Significado |
|---|---|---|
| `row_id` | UUID (ej. `550e8400-e29b-41d4...`) | **Identificador único e inmutable de la fila** — generado por register-from-form.js con `crypto.randomUUID()` |
| `post_tipo` | `single` / `carousel` | Tipo de post |
| `estado_general` | `pending` → `processing` → `published` / `error` | Estado global |
| `estado_render` | `pending` / `processing` / `done` / `error` | Paso 1 |
| `estado_upload` | `pending` / `processing` / `done` / `error` | Paso 2 |
| `estado_publish` | `pending` / `processing` / `done` / `error` | Paso 3 |
| `lock_status` | `free` / `locked` | Mutex por fila — ver regla #1 |
| `intentos` | número | Se incrementa al tomar la fila — máximo 3 |
| `error_step` | string | Último paso que falló (`render`, `upload`, `publish`) |
| `error_message` | string | Mensaje del último error global |
| `instagram_error` | string | Error específico del último intento en Instagram (opcional) |
| `facebook_error` | string | Error específico del último intento en Facebook (opcional) |
| `threads_error` | string | Error específico del último intento en Threads (opcional) |
| `carousel_id` | string | ID compartido por todos los slides del carrusel (prefijo `car_` + 12 chars) |
| `carousel_order` | número | Posición del slide dentro del carrusel |
| `background_color` | hex (`#rrggbb`) | Color asignado al render |
| `media_url` | URL | Imagen subida a Cloudinary — se usa para publicar |
| `cloudinary_public_id` | string | ID del asset en Cloudinary — se borra después de publicar |
| `instagram_media_id` | ID | Seteado después de publicar en IG |
| `updated_at` | ISO 8601 local | Timestamp del último cambio — usado por releaseStaleLocks |

### Sobre `row_id`

Es el identificador oficial de cada fila. Se genera en `register-from-form.js` con
`crypto.randomUUID()` — garantiza unicidad real independientemente del timing o paralelismo.
Es estable e inmune a reordenamientos manuales del sheet — no usar el número de fila como ID.
Se usa por el modo `publish-only` y `unlock-row.js` para encontrar la fila exacta.

### Sobre `instagram_error` / `facebook_error` / `threads_error`

Columnas opcionales. Si no existen en el sheet el pipeline las ignora sin romper nada.
Se escriben individualmente: si Instagram OK pero Facebook falla, solo `facebook_error` tiene valor.
Se limpian al inicio de cada intento. `run-once.js` las lee después de un fallo y las
incluye en la notificación de Telegram para identificar exactamente qué plataforma falló.

---

## Reglas críticas — no romper esto

### Regla #1 — El lock es exclusivo

Una fila con `lock_status = locked` está siendo procesada por otro ciclo.
**Solo `free` es elegible** para iniciar un nuevo paso. Nunca aceptar `locked` como elegible.

```js
// ✅ correcto
lockStatus === LOCK_STATUS.FREE

// ❌ incorrecto — causa doble procesamiento
lockStatus === LOCK_STATUS.FREE || lockStatus === LOCK_STATUS.LOCKED
```

Si un proceso falla, el `catch` siempre escribe `lock_status = free` antes de terminar.
Si el proceso es killed (timeout de GitHub Actions), `releaseStaleLocks` en `run-once.js`
libera las filas bloqueadas al inicio del siguiente ciclo.
Para desbloqueo manual inmediato, usar el input `unlock_id` en `publish.yml`.

### Regla #2 — `releaseStaleLocks` siempre al inicio del ciclo

`run-once.js` llama `releaseStaleLocks({ cycleId })` antes de cualquier pipeline.
Si agregas un nuevo punto de entrada al sistema, también debe llamarlo.
**Excepción:** el modo `publish-only` y `unlock-row.js` lo omiten intencionalmente (son pasos directos y acotados).

### Regla #3 — Siempre usar el logger estructurado

En cualquier script bajo `scripts/`, usar `logger.info / logger.warn / logger.error`.
Nunca `console.log`, `console.warn`, ni `console.error` — no aparecen en los logs
estructurados de GitHub Actions y dificultan el debugging.

```js
// ✅ correcto
const { logger } = require("../utils/logger");
logger.info("Procesando fila", { rowId, cycleId });

// ❌ incorrecto
console.log("Procesando fila", rowId);
```

### Regla #4 — Las paletas tienen una sola fuente de verdad

`scripts/libs/retro-palettes.js` es la fuente. `js/palettes.js` es un espejo generado.
**Nunca editar `js/palettes.js` a mano.** Después de cambiar `retro-palettes.js`, correr:

```bash
npm run sync-palettes
```

Para verificar que estén sincronizadas:

```bash
npm run check-palettes-sync
```

### Regla #5 — Los IDs de fila son UUIDs, nunca números de fila

`row_id` es un UUID generado por `crypto.randomUUID()`. No usar el número de fila de Sheets
como identificador — es mutable si alguien reordena el sheet manualmente.

---

## Inputs del workflow `publish.yml`

| Input | Cuándo usarlo |
|---|---|
| `frases` | Frases nuevas desde el formulario (separadas por `\|\|`) |
| `caption` | Caption del post |
| `tipo` | `carousel` / `single` |
| `color` | Color hex del fondo (vacío = aleatorio) |
| `solo_registrar` | `true` = guardar en sheet sin publicar |
| `reintentar` | `true` = reintentar posts con `estado_general = error` |
| `publish_only` | `row_id` o `carousel_id` — publica sin re-renderizar ni re-subir |
| `unlock_id` | `row_id` o `carousel_id` — desbloquea una fila atascada inmediatamente sin esperar el siguiente ciclo |

---

## Checklist antes de enviar un cambio

1. **¿Usaste `logger` en lugar de `console.*`?**
2. **¿El lock se libera en el `catch`?** (si tocaste un script que escribe `locked`)
3. **¿Editaste `retro-palettes.js`?** → correr `npm run sync-palettes`
4. **¿Agregaste una columna nueva al sheet?** → documentarla aquí y en `arquitectura-proyecto.md`
5. **¿El nuevo código genera IDs?** → usar `crypto.randomUUID()`, nunca `Date.now()` solo
6. **¿Creaste un nuevo punto de entrada al pipeline?** → llamar `releaseStaleLocks` al inicio

---

## Casos de uso operativos frecuentes

### Una fila quedó bloqueada (lock_status = locked)

Opción A — esperar: `releaseStaleLocks` la libera automáticamente al inicio del siguiente ciclo (si lleva más de 10 minutos bloqueada).

Opción B — inmediato: en GitHub Actions → `publish.yml` → Run workflow → campo `unlock_id` → pegar el `row_id` o `carousel_id`.

### Un post falló en publish pero ya tiene la imagen subida

En GitHub Actions → `publish.yml` → Run workflow → campo `publish_only` → pegar el `row_id` o `carousel_id`.
Saltea render y upload, va directo a publicar.

### Quiero guardar frases sin publicar ahora

En el formulario (`publicar.html`), activar "Solo guardar". O desde GitHub Actions, usar `solo_registrar: true`.

### Ver qué plataforma falló exactamente

La notificación de Telegram de error incluye el bloque "Error por plataforma" con el mensaje
específico de Instagram, Facebook y/o Threads según cuál haya fallado. También están en las
columnas `instagram_error`, `facebook_error`, `threads_error` del sheet.

---

## Preguntas frecuentes para la IA

1. **¿Dónde está el estado del sistema?** → Google Sheets, columnas `estado_*` y `lock_status`
2. **¿Cómo se evita el doble procesamiento?** → `lock_status = locked` mientras se procesa, `free` al terminar
3. **¿Cómo se comunica un step con el siguiente?** → A través del sheet; cada step lee el estado que dejó el anterior
4. **¿Por qué hay `runStep` en lugar de llamadas directas?** → `runStep` ejecuta cada script como proceso hijo con timeout de 4 minutos, aislando fallos y evitando que un step colgado bloquee el pipeline completo
5. **¿Dónde se generan los IDs de fila?** → En `register-from-form.js` con `crypto.randomUUID()`
6. **¿Cómo funciona el retry automático?** → `threads-lib.js` y `facebook-lib.js` tienen `withRetry` que reintenta errores transitorios (HTTP 5xx, código de error 1). Los errores de auth y validación fallan inmediatamente.
7. **¿Por qué `publish-only` y `unlock-row` no llaman `releaseStaleLocks`?** → Son operaciones puntuales sobre una fila conocida; el stale check aplica a ciclos completos, no a operaciones manuales.
8. **¿Necesita identificar una fila?** → Usar `row_id`, nunca el número de fila del sheet.
