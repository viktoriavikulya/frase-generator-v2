# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project does

Automated content publishing pipeline for Instagram, Facebook and Threads. Phrases entered via
a web form (`publicar.html`, GitHub Pages) get rendered as retro-3D-styled images (Playwright over
`index.html`), uploaded to Cloudinary, and published to all three platforms. Runs twice daily via
GitHub Actions (`.github/workflows/publish.yml`). There's also a secondary manual curation flow
("Archivo X") for turning saved tweets into carousels.

**Stack:** Node.js (CommonJS) · Google Sheets (state) · Cloudinary · Meta Graph API · Playwright

## Architecture in one line

```
publicar.html → GitHub Actions (publish.yml) → register → render → upload → publish → metrics
```

Each arrow is an independent script (own Node process). **All state travels through a Google
Sheet** — there is no database and no shared memory between steps.

## Commands

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
npm run build:carousel-plan   # generates output/carousel-plan.json from approved Archivo X phrases

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
npm run curate:archivo-x      # curation UI at http://localhost:5177
npm run analyze:phrases-offline -- archivo.txt   # offline scoring, never writes to the sheet
```

There is no automated test suite — `npm run doctor` / `doctor:sheet` are the closest thing to a
correctness check and should be run after touching the pipeline, docs, or palettes.

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
                       curate-saved-tweets (deprecated offline analyzer), taxonomy
    metrics/           fetch-metrics.js — runs Sundays, computes performance_score
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
                       check-palettes-sync, archive-curator-server (port 5177), doctor, doctor-sheet
  archive-x/           legacy versions of jobs that have been migrated to scripts/jobs/ — do not use

tools/archivo-x-curator.html   manual curation UI, served by archive-curator-server.js
data/tweets-guardados-x.txt    input for import:saved-tweets
.github/workflows/publish.yml  main pipeline (schedule 10am/6pm Bogotá + workflow_dispatch)
.github/workflows/metrics.yml  Sunday metrics job (+ manual `days` input)
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

`publish.yml` manual inputs map directly to this model: `publish_only` (row_id/carousel_id, skips
render+upload), `unlock_id` (row_id/carousel_id, frees a stuck row immediately),
`reintentar` (retries rows with `estado_general = error`), `solo_registrar` (write-only, no publish).

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
   `npm run sync-palettes` and verify with `npm run check-palettes-sync`. `publicar.html` also has
   a third hardcoded copy for its inline preview that may need manual updating.

5. **Row IDs are UUIDs (`crypto.randomUUID()`), never sheet row numbers** — row numbers shift
   when rows are reordered/deleted.

## `js/` is the source of truth for rendering

`publicar.html` contains an inline approximate copy of the render code (mode-retro3d, palettes,
etc.) just to show a preview without a server — it is **not** authoritative. The real render that
gets published is done by `render-lib.js` via Playwright over `index.html`, which loads `js/`
directly. Changes to `js/mode-retro3d.js` change production output immediately but do **not**
auto-update the `publicar.html` preview.

## Archivo X (manual curation flow)

100% manual, no automated scoring/classification:

```
data/tweets-guardados-x.txt
  -> npm run import:saved-tweets        (sheet tab "archivo_x", decision_editorial = pendiente)
  -> npm run curate:archivo-x           (http://localhost:5177)
       approve/discard/edit frase_final, assign grupo_carrusel
       only the "Aprobar" button sets decision_editorial = aprobada
       changing grupo_carrusel or frase_final does NOT approve
  -> npm run build:carousel-plan        (only decision_editorial = aprobada rows, min 8 per
                                          grupo_carrusel, uses frase_final or falls back to
                                          frase_original) -> output/carousel-plan.json +
                                          "plan_carruseles" sheet tab
```

`grupo_carrusel` must be one of the 20 groups defined in `scripts/jobs/inspiration/taxonomy.js`. Columns `sirve`,
`estado`, `prioridad`, `calidad`, `riesgo`, `recomendacion_auto`, `accion`, `clasificado_manual`
are legacy and unused by the current flow.

## Operational playbook

- **Telegram reports an error:** check the Sheet row with `estado_general = error`, look at
  `instagram_error` / `facebook_error` / `threads_error` to see which platform failed. If
  `media_url` is already set, use `publish_only` with the `row_id`/`carousel_id` to republish
  without re-rendering. Otherwise use `reintentar: true`.
- **A row is stuck (`lock_status = locked`):** wait ~10 min for `releaseStaleLocks`, or run
  `publish.yml` manually with `unlock_id` = the `row_id`/`carousel_id`.
