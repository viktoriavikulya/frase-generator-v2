# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For the full documentation index (architecture, operations, dev tools, generated artifacts, roadmap), see [`docs/README.md`](docs/README.md).

## What this project does

Automated content publishing pipeline for Instagram, Facebook and Threads. Phrases entered via
a web form (`panel.html`, GitHub Pages) get rendered as retro-3D-styled images (Playwright over
`panel.html?renderEngine=1`), uploaded to Cloudinary, and published to all three platforms. Runs twice daily via
GitHub Actions (`.github/workflows/publish.yml`) on schedule or via `repository_dispatch` from
the panel. There's also a secondary manual curation flow
("Archivo X") for turning saved tweets into carousels.

**Stack:** Node.js (CommonJS) · Google Sheets (state) · Cloudinary · Meta Graph API · Playwright

## Architecture in one line

```
panel.html -> repository_dispatch -> GitHub Actions (publish.yml) -> register -> render -> upload -> publish -> metrics
```

Each arrow is an independent script (own Node process). **All state travels through a Google
Sheet** — there is no database and no shared memory between steps.

## Commands

For a full inventory of every command (what it does, risk level, whether it publishes/writes to
the real Sheet), see [`docs/operations/scripts.md`](docs/operations/scripts.md).

```bash
# Full pipeline (auto: tries carousel first, falls back to single)
node scripts/pipeline/run-once.js

# Force a type
TIPO_INPUT=carousel node scripts/pipeline/run-once.js
TIPO_INPUT=single   node scripts/pipeline/run-once.js

# Individual jobs
npm run render:single / render:carousel
npm run upload:single / upload:carousel
npm run publish:single / publish:carousel
npm run build:carousel-plan   # generates output/carousel-plan.json + "plan_carruseles" tab from
                               # approved Archivo X phrases — legacy, no longer used by the
                               # curator's "Publicar carruseles" tab (see Archivo X section)

# Dev / preview
npm run render                                  # quick CLI preview of one phrase -> /output
node scripts/dev/render-all-retro-colors.js     # one PNG per palette, for visual review

# Palettes (single source of truth lives in scripts/config/retro-palettes.js)
npm run sync-palettes        # source -> js/palettes.js mirror
npm run check-palettes-sync  # verify they're in sync (usable in CI)

# Diagnostics
npm run doctor        # validates files, exports, syntax, docs and palette sync
npm run doctor:sheet  # audits Google Sheet columns/states

# Archivo X (manual curation flow)
npm run import:saved-tweets   # imports data/tweets-guardados-x.txt into the "archivo_x" sheet tab
npm run curate:archivo-x      # curator API at http://localhost:5177; daily UI is panel.html#curate

# panel.html locally (two terminals)
npm run curate:archivo-x      # terminal 1 — curator API at http://localhost:5177
npm run panel                 # terminal 2 — serves panel.html at http://localhost:5173/panel.html
                               # (set "Curator URL" in the panel to http://localhost:5177)
                               # do NOT open panel.html via file:// — fetch() to the curator API
                               # fails CORS ("Failed to fetch") from a file:// origin
```

There is no automated test suite — `npm run doctor` / `doctor:sheet` are the closest thing to a
correctness check and should be run after touching the pipeline, docs, or palettes.

## Current stable operation

- Official panel URL: `https://imgifra.github.io/frase-generator-v2/panel.html`.
- Only versioned HTML: `panel.html`.
- Render engine: `panel.html?renderEngine=1`.
- `publish.yml` runs through `schedule` and `repository_dispatch` (`event_type: publish-posts`).
- `metrics.yml` runs through a weekly `schedule` (`0 15 * * 0`, ~Sunday 10:00 a.m. Colombia) and
  `repository_dispatch` (`event_type: update-metrics`, payload `{ "days": "30" }`), sent from
  `panel.html#operations` -> "Actualizar métricas" (input `Días a consultar`, default 30,
  documented range 1-365; `metrics.yml` reads it as
  `METRICS_DAYS: ${{ github.event.client_payload.days || '30' }}`).
- `workflow_dispatch` was removed from both `publish.yml` and `metrics.yml`; do not use GitHub
  Actions **Run workflow** as a normal flow. GitHub Actions remains the execution engine and run
  log, but normal operation happens from `panel.html#operations` (Publish Posts, Actualizar
  Métricas, run history).
- `panel.html#operations` also has an "Historial de ejecuciones" block ("Actualizar historial"
  button): lists up to 10 recent runs of `publish.yml` and `metrics.yml` merged, via
  `GET /actions/workflows/{workflow}/runs?per_page=5`, showing workflow, status/conclusion,
  event, branch, short SHA, dates and a link to the run. It does NOT filter by event or branch —
  it includes `repository_dispatch`, `schedule` and historical runs, so old `workflow_dispatch`
  runs may appear even though that trigger no longer exists.
- The GitHub token is entered in the panel's `Token de GitHub` field and is not stored in
  `localStorage`. For `repository_dispatch`, fine-grained PATs need `Contents: write` on this repo;
  classic PATs need `repo`. The same token works for both the Publish Posts (`publish-posts`) and
  Actualizar Métricas (`update-metrics`) dispatches. Reading the run history additionally needs
  `Actions: read` on fine-grained PATs (a classic PAT's `repo` scope already covers it). The
  history block requires the token.
- Stable tags: `v-panel-unico-stable`, `v-panel-operations-stable`,
  `v-panel-repository-dispatch-stable`, `v-panel-repository-dispatch-docs` (previous documented
  state), `v-panel-operations-metrics-stable` (metrics operated from Operaciones, no
  `workflow_dispatch` in `metrics.yml`), `v-panel-operations-history-stable` (Operaciones with
  the run history block).

## Repo layout

```
js/                    Frontend generator (runs inside Playwright/browser) — THE SOURCE OF
                       TRUTH for what gets rendered and published
  app.js               Orchestrates modes; sets window.renderReady = true when done
  mode-retro3d.js      The only mode used in production
  mode-brat.js / mode-normal.js   legacy / basic modes, not used in prod
  palettes.js          GENERATED mirror of scripts/config/retro-palettes.js — never edit by hand
  config.js, branding.js, utils.js

scripts/
  auth/                google-auth.js — service account for Google Sheets
  core/
    sheets.js          Google Sheets client (readRows, updateCellsBatch, buildHeaderMap, getCellValue)
    status.js          STATUS / GENERAL_STATUS / POST_TIPOS / LOCK_STATUS / MAX_INTENTOS constants
  config/
    retro-palettes.js  SOURCE OF TRUTH for the 30 palettes (BG_SEQUENCE etc.)
  libs/
    graph-client.js    Base HTTP helpers for Meta Graph API (graphGet, graphPost, buildGraphErrorMessage)
    instagram-lib.js / facebook-lib.js / threads-lib.js   per-platform publishing (containers, polling,
                       carousels; facebook/threads have automatic retry on transient errors)
    render-lib.js      Local HTTP server + Playwright driver; handles SIGTERM/SIGINT
    upload-lib.js      Cloudinary upload/delete
    telegram-lib.js    Telegram notifications (success/error, with per-platform error blocks)
  pipeline/
    run-once.js        Entry point — picks single/carousel/auto/publish-only based on TIPO_INPUT,
                       calls releaseStaleLocks() first, and on failure reads per-platform errors
                       (instagram_error/facebook_error/threads_error) for the Telegram notification
    run-single.js / run-carousel.js   call pipeline-runner.js with their step config
    register-from-form.js   writes phrases from the form into the sheet as "pending" rows
    unlock-row.js      manually frees a stuck row (lock_status=locked or estado_general=processing)
  jobs/
    single/ , carousel/   render-/upload-/publish-*-from-sheet.js per post type, plus
                       carousel/build-carousel-plan.js
    inspiration/       Archivo X flow: fetch-inspiration, import-saved-tweets-to-sheet,
                       taxonomy
    metrics/           fetch-metrics.js — runs Sundays (or on demand from panel Operaciones),
                       computes performance_score
  utils/
    pipeline-runner.js executes render -> upload -> publish steps in order
    pipeline-utils.js  runStep (4 min timeout, child process) + releaseStaleLocks (frees rows
                       locked >10 min) + buildStepEnv
    render-job-utils.js  shared helpers for the render-*-from-sheet jobs (runRenderJob,
                       buildProcessingUpdates, stopServer wiring)
    carousel-utils.js  groups sheet rows by carousel_id, validates 2-10 slides / no dup order
    render-utils.js    smart background color selection (avoids repeating recent palettes)
    common.js          nowIsoLocal(), colToLetter(), normalizeValue()
    logger.js          structured JSON logger
  dev/                 local-only tools (never run in production): render-preview, sync-palettes,
                       check-palettes-sync, doctor, doctor-sheet.
                       archive-curator-server (port 5177; serves Archivo X APIs) is the one
                       exception — it's also deployed to Render (render.yaml, service
                       "archivo-x-curator") as the production backend panel.html talks to by
                       default, so it's not local-only. Its catch-all route (and the explicit
                       /archivo-x-curator.html path) redirect (302) to panel.html#curate.

tools/archivo-x-curator.html   REMOVED in Phase C5 — was the legacy curaduría UI ("Curaduría" +
                                "Publicar carruseles" tabs). The /archivo-x-curator.html URL is
                                kept as a compatibility redirect (302) to panel.html#curate in
                                archive-curator-server.js; the physical file no longer exists.
data/tweets-guardados-x.txt    input for import:saved-tweets
.github/workflows/publish.yml  main pipeline (schedule 10am/6pm Bogota + repository_dispatch)
.github/workflows/metrics.yml  Sunday metrics job (schedule + repository_dispatch update-metrics;
                               days window via client_payload.days, default 30)
```

## State model: the Google Sheet

Every row is a post (or one carousel slide). Key columns:

- `row_id` — UUID from `crypto.randomUUID()`, generated in `register-from-form.js`. **Immutable
  identifier** — never use the sheet row number as an ID (it shifts).
- `carousel_id` (`car_` + 12 chars) / `carousel_order` — group and order slides of a carousel.
- `estado_general`: `pending` → `processing` → `published` / `error`. Mirrored per-step in
  `estado_render` / `estado_upload` / `estado_publish`.
- `lock_status`: `free` / `locked` — mutex per row (see critical rule #1 below).
- `intentos` (max `MAX_INTENTOS = 3`), `error_step`, `error_message`.
- `instagram_error` / `facebook_error` / `threads_error` — optional, per-platform error from the
  last attempt; ignored if the columns don't exist in the sheet.
- `background_color`, `output_file`, `media_url`, `cloudinary_public_id`, `instagram_media_id`.
- `updated_at` (ISO local) — used by `releaseStaleLocks` to detect stale rows (>10 min).

`panel.html` sends `repository_dispatch` (`event_type: publish-posts`) to `publish.yml`. Its
`client_payload` maps directly to this model: `publish_only` (row_id/carousel_id, skips
render+upload), `unlock_id` (row_id/carousel_id, frees a stuck row immediately), `reintentar`
(retries rows with `estado_general = error`), `solo_registrar` (write-only, no publish), and
`target_carousel_id` (runs the full render+upload+publish pipeline immediately for one specific
`carousel_id`, used by panel.html's "Registrar y publicar ahora" button -- unlike `publish_only`,
this does NOT skip render/upload, so it works for a freshly-registered pending carousel with no
`media_url` yet). `panel.html#operations` also sends `repository_dispatch`
(`event_type: update-metrics`, `client_payload: { days }`) to `metrics.yml` via the "Actualizar
métricas" button. `workflow_dispatch` was removed from both `publish.yml` and `metrics.yml`; the
GitHub Actions manual Run workflow form is no longer part of normal operation.

## Critical rules

1. **The lock is exclusive.** Only `lock_status === LOCK_STATUS.FREE` rows are eligible —
   never treat `locked` as eligible too. Every `catch` that took a lock must set
   `lock_status = free` before exiting. If a process is killed, `releaseStaleLocks` (called by
   `run-once.js` at the start of every cycle) frees rows locked >10 min. `publish-only` and
   `unlock-row.js` intentionally skip `releaseStaleLocks` — they target one known row.

2. **New pipeline entry points must call `releaseStaleLocks({ cycleId })`** at the start, like
   `run-once.js` does.

3. **Always use the structured logger** (`scripts/utils/logger.js`), never `console.*` —
   `console.log` output doesn't show up in GitHub Actions' structured logs.

4. **Palettes have one source of truth: `scripts/config/retro-palettes.js`.** `js/palettes.js` is
   a generated mirror — never hand-edit it. After changing `retro-palettes.js`, run
   `npm run sync-palettes` and verify with `npm run check-palettes-sync`.

5. **Row IDs are UUIDs (`crypto.randomUUID()`), never sheet row numbers** — row numbers shift
   when rows are reordered/deleted.

## Rendering surfaces

`panel.html?renderEngine=1` + `js/` are the source of truth for rendering. The production PNG is
generated by `render-lib.js` through Playwright over `panel.html?renderEngine=1`, which loads
`js/config.js`, `js/utils.js`, the mode scripts, `js/branding.js` and `js/app.js` in that order
(`js/palettes.js` is loaded statically by `panel.html` itself). `index.html` was deleted in Phase
C7B — the render engine now lives inside `panel.html` behind the `renderEngine=1` query param.

Daily panel and backend entry points are split by deployment plane:

- `panel.html` is the **only main HTML page** and the GitHub Pages entry point, with six tabs:
  `Publicar Ahora` (publish form), `Curar Frases`, `Agregar Frases`, `Armar Carruseles`,
  `Preview` (a standalone render tester for any text/mode/color), and `Operaciones` (retry,
  publish-only, unlock, metrics update, run history, and links to GitHub Actions/the
  newly-triggered run). The official entry
  URL is `/panel.html` --
  the bare GitHub Pages root is no longer kept as an entry point (it 404s since `index.html` was
  deleted in Phase C7B; that was accepted explicitly).
- `publicar.html` was deleted in Phase C6 — publishing lives entirely in `panel.html#publish` now.
  Old links to `publicar.html` are not kept working (404 on GitHub Pages); that risk was accepted
  explicitly when removing it.
- The Publish and Preview tabs' previews use a hidden iframe pointed at
  `panel.html?renderEngine=1` and communicate via `postMessage`, so they ask the real renderer for
  a `canvas.toDataURL()` instead of keeping a copied renderer.
- Render runs `scripts/dev/archive-curator-server.js` and exposes `/api/phrases`, `/api/taxonomy`,
  `/api/raw-phrases`, and `/api/plan-carruseles`. `panel.html` calls those APIs directly from
  GitHub Pages; `tools/archivo-x-curator.html` (the legacy curator UI file) was deleted in Phase
  C5 — both `/` and `/archivo-x-curator.html` redirect (302) to `panel.html#curate` instead (that
  legacy UI never exposed the `Agregar Frases` raw-intake form anyway, only the daily `panel.html`
  UI does).

Do not copy render functions into the admin side of `panel.html`. If the visual output changes, update `js/mode-retro3d.js` / `js/config.js` and verify through `panel.html?renderEngine=1` or `render-preview.js`.

## Archivo X (manual curation flow)

100% manual, no automated scoring/classification:

```
Two equivalent ways in, both land in sheet tab "archivo_x" with decision_editorial = pendiente:
  data/tweets-guardados-x.txt -> npm run import:saved-tweets
  panel.html#raw ("Agregar Frases")  -> POST /api/raw-phrases

  -> panel.html#curate / panel.html#carousel   (GitHub Pages, daily UI)
     or npm run curate:archivo-x        (http://localhost:5177 — the API only; visiting it in a
                                          browser now redirects to panel.html#curate)
       "Curar Frases" / legacy "Curaduría" tab: approve/discard/edit frase_final, assign
         grupo_carrusel
         only the "Aprobar" button sets decision_editorial = aprobada
         changing grupo_carrusel or frase_final does NOT approve
       "Armar Carruseles" / legacy "Publicar carruseles" tab: pick exactly 10 approved phrases
         from one grupo_carrusel + caption (+ optional color) -> registers them as a
         new pending carousel directly in Hoja 2, then sets
         decision_editorial = publicada on those archivo_x rows
```

`grupo_carrusel` must be one of the 20 groups defined in `scripts/jobs/inspiration/taxonomy.js`. Columns `sirve`,
`estado`, `prioridad`, `calidad`, `riesgo`, `recomendacion_auto`, `accion`, `clasificado_manual`
are legacy and unused by the current flow.

### `panel.html#raw` ("Agregar Frases") and `POST /api/raw-phrases`

Manual raw-phrase intake, parallel to `npm run import:saved-tweets` but driven from the UI instead
of `data/tweets-guardados-x.txt`. Body: `{ phrases: string[], notes?: string }`. For each phrase
the server writes a new `archivo_x` row with `decision_editorial = "pendiente"`, `frase_final = ""`,
`grupo_carrusel = ""`, `temporalidad = "atemporal"`, `notas` = the shared notes field, `fuente =
"manual_panel"`, and `id` computed by the same `buildArchiveId()` (sha1 of the normalized text) used
by `import-saved-tweets-to-sheet.js` — so a phrase pasted manually and the same phrase later
imported from the txt file resolve to the same id and dedup against each other. Dedup reuses that
module's exported `normalizeForDedup()` against both the existing sheet rows and the rest of the
pasted batch; phrases under 3 characters or blank lines are skipped. Response reports
`{ inserted, duplicates, skippedEmpty, skippedShort }`; nothing is auto-approved or added to any
carousel plan — new rows only show up under the curator's "Pendientes" filter.

### `decision_editorial` values

`pendiente` (default on import) -> `aprobada` (via curator "Aprobar") -> `publicada` (set
automatically once registered into Hoja 2 via "Publicar carruseles"). `descartada` means the
curator rejected the phrase. `indeterminada` (via curator "No sé") is a holding state for phrases
the curator can't classify yet — it removes them from the `pendiente` queue without approving or
discarding them; they're reviewable later from their own "No sé / Indeterminadas" filter. Only
`aprobada` rows are eligible for "Publicar carruseles" (so `indeterminada` rows never enter a
carousel plan). Once a row is `publicada` it no longer appears there or in the curator's
Pendientes/Aprobadas/Descartadas/No sé filters (only "Todas" shows it).
`archive-curator-server.js` also accepts `indeterminado` / `no_se` / `no sé` / `no se` as input
aliases and normalizes them to `indeterminada` before writing to the Sheet.

**Known gap:** `getSummary()` in `archive-curator-server.js` (used by `GET /api/phrases`) only
buckets rows into `aprobada` / `descartada` / else-`pendiente`, so `publicada` rows are currently
counted as `pendiente` in that summary. Not fixed yet — low priority, cosmetic only.

### "Publicar carruseles" tab and its API

- `GET /api/plan-carruseles` — reads `archivo_x` directly (same `loadArchive()` as
  `GET /api/phrases`), filters `decision_editorial === "aprobada"`, groups by normalized
  `grupo_carrusel`, returns `{ worksheet, groups: { [grupo]: [items...] } }` with **all** approved
  rows per group (no 10-row cap — the UI enforces picking exactly 10 via checkboxes).
- `POST /api/plan-carruseles/registrar` — body `{ rowNumbers, caption, color }`. Validates 1-10
  rows, all `aprobada`, same `grupo_carrusel`, non-empty `frase_final || frase_original`. Calls
  `registerFrases()` from `scripts/pipeline/register-from-form.js` (tipo `single` for 1 phrase,
  `carousel` for 2-10) to write new `pending` rows into Hoja 2, then marks the source `archivo_x`
  rows `decision_editorial = "publicada"` (+ `actualizado_en`). If that marking write fails, the
  response still has `success: true` (Hoja 2 write is already irreversible) plus a `warning`
  field telling the curator those rows might reappear in `GET /api/plan-carruseles`.

### `plan_carruseles` / `build:carousel-plan` — currently unused by the curator

`npm run build:carousel-plan` and the `plan_carruseles` sheet tab still exist (and `output/`
generation may have other consumers) but are **no longer read by the curator's "Publicar
carruseles" tab**, which now goes straight from `archivo_x` to Hoja 2. Not removed yet — treat as
legacy until confirmed nothing else depends on them.

## Operational playbook
- **Telegram reports an error:** check the Sheet row with `estado_general = error`, look at
  `instagram_error` / `facebook_error` / `threads_error` to see which platform failed. If
  `media_url` is already set, use `panel.html` -> `Operaciones` -> publish-only with the
  `row_id`/`carousel_id` to republish without re-rendering. Otherwise use `Operaciones` ->
  `Reintentar ahora`.
- **A row is stuck (`lock_status = locked`):** wait ~10 min for `releaseStaleLocks`, or use
  `panel.html` -> `Operaciones` -> unlock with the `row_id`/`carousel_id`.
- **Metrics need a refresh before Sunday:** use `panel.html` -> `Operaciones` -> `Actualizar
  métricas` with the days window (1-365, default 30) — do not trigger `metrics.yml` manually from
  GitHub Actions (its **Run workflow** button no longer exists).
- **Want to know what ran recently:** use `panel.html` -> `Operaciones` -> `Actualizar historial`
  (last 10 merged runs of `publish.yml` + `metrics.yml`; unfiltered, so scheduled runs and old
  `workflow_dispatch` runs also appear).

