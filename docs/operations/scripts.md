# Inventario de scripts y comandos

Mapa completo de qué hace cada comando del proyecto, para saber cuáles son seguros de probar
sueltos y cuáles pueden publicar contenido real o tocar el Google Sheet de producción. Cruza con
[`docs/architecture/entrypoints.md`](../architecture/entrypoints.md) (qué es cada HTML) y
[`docs/architecture/mapa-del-proyecto.md`](../architecture/mapa-del-proyecto.md) (riesgos y
verificaciones por tipo de cambio de código). Para el detalle archivo por archivo de
`scripts/dev/` y `tools/`, ver [`docs/operations/dev-tools.md`](dev-tools.md).

Niveles de riesgo usados abajo:

- **Bajo** — solo lectura, validación local, o sirve archivos estáticos. No escribe en el Sheet
  ni llama APIs externas de publicación.
- **Medio** — escribe en el Google Sheet y/o genera archivos, pero no publica en redes ni gasta
  cuota de APIs de publicación.
- **Alto** — publica en Instagram/Facebook/Threads, sube contenido, o corre el pipeline completo
  de producción. No ejecutar sin saber exactamente qué fila/carrusel se va a afectar.

## Comandos de `package.json`

| Comando | Script ejecutado | Categoría | Riesgo | Cuándo usarlo | Notas |
| --- | --- | --- | --- | --- | --- |
| `npm run panel` | `http-server . -p 5173 -c-1` | panel/local | Bajo | Para abrir `panel.html` en local sin usar `file://`. | Ver `docs/architecture/entrypoints.md`. No toca ningún backend por sí solo. |
| `npm run curate:archivo-x` | `node scripts/dev/archive-curator-server.js` | curaduría | Medio | Para levantar la API de Archivo X en local (`http://localhost:5177`) mientras se usa `panel.html` o `tools/archivo-x-curator.html`. | Usa credenciales de Google Sheets (`SHEET_ID`, service account). Escribe en la pestaña `archivo_x`. |
| `npm run start:archivo-x` | mismo script que `curate:archivo-x` | curaduría | Medio | No se corre a mano — es el `startCommand` que usa el deploy de Render (`render.yaml`, servicio `archivo-x-curator`). | Mismo código, pero en producción sirve a `panel.html` real vía `archivo-x-curator.onrender.com`. |
| `npm run import:saved-tweets` | `node scripts/jobs/inspiration/import-saved-tweets-to-sheet.js` | curaduría | Medio | Para meter `data/tweets-guardados-x.txt` a la pestaña `archivo_x` como filas `pendiente`. | Deduplica por texto normalizado antes de escribir. |
| `npm run fetch:inspiration` | `node scripts/jobs/inspiration/fetch-inspiration.js` | inspiración | Medio | Para llenar la pestaña `inspiracion` con candidatos de X/Bluesky para revisar manualmente. | Llama APIs externas (X Bearer Token / Bluesky) — puede gastar cuota. Soporta `INSPIRATION_DRY_RUN=true` para probar sin escribir. |
| `npm run fetch:metrics` | `node scripts/jobs/metrics/fetch-metrics.js` | métricas | Medio | Para recalcular métricas (`performance_score`, `saves`, `reach`, etc.) sin esperar al cron de los domingos. | Llama a la Meta Graph API (insights de IG/FB/Threads) y escribe columnas de métricas en Hoja 2. Igual que corre `.github/workflows/metrics.yml`. |
| `npm run render` | `node scripts/dev/render-preview.js` | dev/debug | Bajo | Preview rápido de una frase suelta, resultado en `/output`. | No toca el Sheet. |
| `npm run render:single` | `node scripts/jobs/single/render-single-from-sheet.js` | render | Medio | Paso de render del pipeline para posts sueltos, leyendo filas `pending` del Sheet. | Actualiza `estado_render` y toma un `lock_status`. Parte del pipeline real, no un preview. |
| `npm run render:carousel` | `node scripts/jobs/carousel/render-carousel-from-sheet.js` | render | Medio | Igual que arriba, pero para carruseles. | Idem — actualiza estado y locks reales. |
| `npm run upload:single` | `node scripts/jobs/single/upload-single-from-sheet.js` | upload | Medio-alto | Paso de upload del pipeline: sube el PNG renderizado a Cloudinary. | Usa credenciales de Cloudinary; actualiza `media_url` / `cloudinary_public_id`. |
| `npm run upload:carousel` | `node scripts/jobs/carousel/upload-carousel-from-sheet.js` | upload | Medio-alto | Igual que arriba, para carruseles. | Idem. |
| `npm run publish:single` | `node scripts/jobs/single/publish-single-from-sheet.js` | publish | **Alto** | Paso final: publica de verdad en Instagram/Facebook/Threads. | Usa la Meta Graph API con tokens reales. **No correr sin intención explícita.** |
| `npm run publish:carousel` | `node scripts/jobs/carousel/publish-carousel-from-sheet.js` | publish | **Alto** | Igual que arriba, para carruseles. | Idem. |
| `npm run build:carousel-plan` | `node scripts/jobs/carousel/build-carousel-plan.js` | pipeline (carrusel) | Medio | Genera `output/carousel-plan.json` y la pestaña `plan_carruseles` desde frases aprobadas de Archivo X. | **Legacy**: ya no lo usa la pestaña "Publicar carruseles" del curador (esa va directo de `archivo_x` a Hoja 2). Ver `CLAUDE.md`. |
| `npm run sync-palettes` | `node scripts/dev/sync-palettes.js` | dev/debug | Bajo | Después de editar `scripts/config/retro-palettes.js`, para regenerar el espejo `js/palettes.js`. | Solo escribe un archivo local, no toca el Sheet. |
| `npm run check-palettes-sync` | `node scripts/dev/check-palettes-sync.js` | doctor/validación | Bajo | Para verificar que `retro-palettes.js` y `js/palettes.js` están sincronizados (usable en CI). | Solo lectura/comparación. |
| `npm run doctor` | `node scripts/dev/doctor.js` | doctor/validación | Bajo | Después de tocar pipeline, docs o paletas — valida archivos, sintaxis, exports y docs. | Solo lectura local, no llama al Sheet real. Cobertura ampliada en dos fases: A.11 llevó la validación de scripts de `package.json` de 14 a 18, y de sintaxis de 16 a 22 archivos. A.12 sumó los 17 restantes de `scripts/pipeline/`, `scripts/libs/`, `scripts/core/`, `scripts/auth/` y `scripts/utils/` — hoy son **39 archivos `.js`** con chequeo de sintaxis (vía el mecanismo seguro `vm.Script`, nunca `require()` real). Ya no queda ningún script de esas carpetas sin cobertura estática. |
| `npm run doctor:sheet` | `node scripts/dev/doctor-sheet.js` | doctor/validación | Bajo (solo lectura, pero usa red) | Para auditar columnas y estados del Google Sheet real. | Usa credenciales para **leer** el Sheet; no escribe. |

## Comandos sin alias en `package.json` (se invocan con `node ...` directo)

Estos no aparecen en `npm run ...` pero son justo los que corre GitHub Actions o los que se usan
para mantenimiento manual — igual de importantes para saber qué es seguro tocar.

| Comando | Categoría | Riesgo | Cuándo usarlo | Notas |
| --- | --- | --- | --- | --- |
| `node scripts/pipeline/run-once.js` | pipeline | **Alto** | Corre el pipeline completo (register → render → upload → publish) igual que lo hace `publish.yml`. | Soporta `TIPO_INPUT=carousel` / `TIPO_INPUT=single`. Llama `releaseStaleLocks` primero. **Publica en redes reales si llega hasta el final.** Deliberadamente sin alias `npm run` — un `npm run pipeline` facilitaría correrlo por accidente (ver nota más abajo). |
| `node scripts/pipeline/register-from-form.js` | pipeline | Medio | Registra frases nuevas como filas `pending` en Hoja 2 (lo usa el workflow cuando llega un submit del formulario). | No publica por sí solo, pero es el primer paso del pipeline real. Solo tiene sentido con las env vars que arma el workflow (`FRASES_INPUT`, etc.) — sin alias `npm run` a propósito. |
| `node scripts/pipeline/unlock-row.js` | pipeline / mantenimiento | Medio | Para liberar a mano una fila con `lock_status=locked` sin esperar los 10 min de `releaseStaleLocks`. | Requiere `UNLOCK_ID=<row_id o carousel_id>`. Deja `estado_general=error` para que el próximo ciclo reintente. Actúa sobre una fila puntual, no sobre todo el Sheet. Deliberadamente sin alias `npm run` (ver nota más abajo). |
| `node scripts/dev/render-all-retro-colors.js` | dev/debug | Bajo | Genera un PNG por cada una de las 30 paletas, para revisión visual. | Solo escribe en `/output`, no toca el Sheet. |
| `node scripts/dev/debug-layout-tmp.js` | dev/debug | Bajo | Ayuda temporal para depurar el layout de texto retro3D con un set de frases fijas, sirviendo un preview en `:8099`. | Es explícitamente temporal (ver mensaje del commit "Keep retro3d layout debug helper") — no es parte del flujo oficial documentado. |

## Comandos de uso diario

```bash
# Terminal 1 — API del curador
npm run curate:archivo-x

# Terminal 2 — el panel
npm run panel
# abrir http://localhost:5173/panel.html
```

Desde ahí: publicar frases nuevas, curar Archivo X (incluye "Agregar Frases" y "No sé"), y armar
carruseles. Este es el flujo que reemplaza casi todo lo demás en el día a día.

## Comandos de curaduría

```bash
npm run import:saved-tweets   # mete data/tweets-guardados-x.txt a "archivo_x" como pendiente
npm run curate:archivo-x      # API que usa panel.html#curate / panel.html#raw
```

## Comandos de render / upload / publish (pipeline real)

```bash
npm run render:single    # o render:carousel
npm run upload:single    # o upload:carousel
npm run publish:single   # o publish:carousel   <- ALTO: esto publica de verdad

# o el pipeline completo de una vez (lo mismo que corre GitHub Actions):
node scripts/pipeline/run-once.js
TIPO_INPUT=carousel node scripts/pipeline/run-once.js
TIPO_INPUT=single   node scripts/pipeline/run-once.js
```

Correr estos sueltos fuera de GitHub Actions solo tiene sentido para debug puntual de un paso
específico, sabiendo qué fila del Sheet se va a tocar.

## Comandos de inspiración

```bash
npm run fetch:inspiration                                    # candidatos reales
INSPIRATION_DRY_RUN=true npm run fetch:inspiration            # probar sin escribir nada
INSPIRATION_SOURCE=bluesky npm run fetch:inspiration           # si X se queda sin créditos
```

## Comandos de métricas

```bash
npm run fetch:metrics                 # últimos 30 días (default)
METRICS_DAYS=7 npm run fetch:metrics  # ventana más corta
```

Llama a la Meta Graph API real y escribe en Hoja 2 — mismo efecto que espera al domingo a que
corra `metrics.yml`. No hace falta confirmación especial, pero no correrlo repetidamente sin
necesidad (gasta cuota de la API de insights).

## Comandos de validación (siempre seguros)

```bash
npm run doctor                # valida archivos, sintaxis, exports, docs y paletas — solo local
npm run doctor:sheet          # audita el Sheet real, pero solo lectura
npm run check-palettes-sync   # compara paletas backend vs frontend
```

## Comandos peligrosos o de uso cuidadoso

No correr sin saber exactamente qué se va a afectar:

- `npm run publish:single` / `npm run publish:carousel` — publican de verdad en redes.
- `node scripts/pipeline/run-once.js` (con o sin `TIPO_INPUT`) — pipeline completo hasta publish.
- `node scripts/pipeline/unlock-row.js` — modifica `lock_status`/`estado_general` de una fila real.
- `npm run upload:single` / `npm run upload:carousel` — suben contenido a Cloudinary de verdad.

## Nota: alias agregado (Fase A.10)

`scripts/jobs/metrics/fetch-metrics.js` ahora tiene alias `npm run fetch:metrics` en
`package.json` (antes solo se invocaba directo en `.github/workflows/metrics.yml`, que sigue
usando `node scripts/jobs/metrics/fetch-metrics.js` sin cambios).

En la misma auditoría se revisó si convenía agregar alias para `run-once.js`,
`register-from-form.js` y `unlock-row.js` (los tres corridos por `publish.yml` sin alias). Se
decidió **no** agregarles uno: son de riesgo medio/alto y requieren contexto específico (env vars
del workflow, o un `TIPO_INPUT`/`UNLOCK_ID` puntual) — un alias `npm run` los haría más fáciles de
correr por accidente sin ese contexto. Quedan documentados arriba como comandos deliberadamente
sin alias.
