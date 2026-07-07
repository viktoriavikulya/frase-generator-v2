# Herramientas de desarrollo (`scripts/dev/` y `tools/`)

Inventario detallado de cada archivo en `scripts/dev/` — qué hace, dónde está referenciado, y qué
tan seguro es tocarlo/moverlo más adelante. Complementa a
[`docs/operations/scripts.md`](scripts.md) (que cubre todos los comandos del proyecto) y a
[`docs/architecture/entrypoints.md`](../architecture/entrypoints.md) (que cubre los HTML de raíz).

`tools/` quedó vacía desde la Fase C5 — su único archivo, `archivo-x-curator.html`, se eliminó
del repo (ver la última fila de la tabla de abajo para el detalle histórico).

Ningún archivo listado aquí se movió o modificó al escribir este documento — es solo auditoría.

## Tabla completa

| Archivo | Rol | Referencias | Categoría | Riesgo si se mueve | Recomendación |
| --- | --- | --- | --- | --- | --- |
| `scripts/dev/archive-curator-server.js` | Servidor Express: API de Archivo X (`/api/phrases`, `/api/raw-phrases`, `/api/plan-carruseles`, `/api/taxonomy`). Su ruta catch-all y `/archivo-x-curator.html` redirigen (302) a `panel.html#curate`. | `package.json` (`curate:archivo-x`, `start:archivo-x`), `render.yaml` (`startCommand` de producción), `doctor.js` (`REQUIRED_FILES` + `CHECKED_JS_FILES`), `CLAUDE.md`, `docs/architecture/entrypoints.md`, `docs/architecture/mapa-del-proyecto.md`, `docs/operations/scripts.md`, `README.md`. | curaduría activa | **Alto** — es el único script de `scripts/dev/` que `doctor.js` verifica explícitamente (existencia + sintaxis), y es literalmente el `startCommand` del deploy de Render. Moverlo rompe producción si no se actualiza `render.yaml` y `package.json`. | No mover en esta fase. Ver `docs/architecture/entrypoints.md`. |
| `scripts/dev/doctor.js` | Valida archivos requeridos, sintaxis, exports, docs y sync de paletas. Es `npm run doctor`. | `package.json` (`doctor`), `README.md`, `CLAUDE.md`, `docs/operations/scripts.md`, `.claude/settings.local.json` (config local no versionada). | dev activo / diagnóstico | Bajo-medio — desde la Fase A.11 `doctor.js` sí está en su propia `CHECKED_JS_FILES` (se autovalida la sintaxis), aunque sigue sin estar en `REQUIRED_FILES`. Moverlo sin actualizar `package.json` ahora falla en `syntax:scripts/dev/doctor.js` al correr `npm run doctor` desde la ruta vieja — aunque si ya se movió, `npm run doctor` mismo dejaría de poder invocarse por ese alias. | No mover. Es la herramienta de validación central del repo. |
| `scripts/dev/doctor-sheet.js` | Audita columnas/estados del Google Sheet real — **solo lectura**, no hay ninguna llamada de escritura en el archivo. Es `npm run doctor:sheet`. | `package.json` (`doctor:sheet`), `CLAUDE.md`, `docs/operations/scripts.md`. | diagnóstico | Bajo-medio — no está en `REQUIRED_FILES`, pero desde la Fase A.11 sí está en `CHECKED_JS_FILES`: moverlo sin actualizar `package.json` ahora lo detecta `npm run doctor` (sintaxis falla con archivo no encontrado). | No mover sin actualizar `package.json` en el mismo cambio. |
| `scripts/dev/check-palettes-sync.js` | Compara `scripts/config/retro-palettes.js` contra `js/palettes.js`; falla con `exit(1)` si difieren (usable en CI). Es `npm run check-palettes-sync`. | `package.json`, `CLAUDE.md`, `README.md`, `docs/architecture/mapa-del-proyecto.md`, `docs/operations/scripts.md`. | paletas / diagnóstico | Bajo-medio — igual que arriba, ya cubierto por `CHECKED_JS_FILES` desde la Fase A.11. | No mover. Nota menor: su propio comentario interno dice `npm run check-palettes-sync ← agregar a package.json si querés`, pero ese script **ya está** en `package.json` — es un comentario desactualizado dentro del archivo, no un problema funcional. No lo corregí (fuera del alcance permitido). |
| `scripts/dev/sync-palettes.js` | Sincroniza `scripts/config/retro-palettes.js` → `js/palettes.js` (reemplaza el bloque entre los marcadores `// RETRO_PALETTES_START/END`). Es `npm run sync-palettes`. | `package.json`, `CLAUDE.md`, `README.md`, `docs/architecture/mapa-del-proyecto.md`, `docs/operations/scripts.md`, y usado internamente por `check-palettes-sync.js` (menciona el comando en su mensaje de error). | paletas | Bajo-medio — igual que arriba, ya cubierto por `CHECKED_JS_FILES` desde la Fase A.11. | No mover sin actualizar `package.json`. |
| `scripts/dev/render-preview.js` | Preview rápido de una frase (`node scripts/dev/render-preview.js "texto" modo "#color"`), guarda PNG en `/output`. Es `npm run render`. | `package.json` (`render`), `CLAUDE.md`, `docs/architecture/mapa-del-proyecto.md`, `docs/operations/scripts.md`, `docs/operations/orden-para-ejecucion.md`, `.claude/settings.local.json` (config local no versionada, lo usa para pruebas rápidas). | render preview | Bajo-medio — igual que arriba, ya cubierto por `CHECKED_JS_FILES` desde la Fase A.11. También es el checklist recomendado en `docs/architecture/mapa-del-proyecto.md` para validar cambios visuales retro3D. | No mover sin actualizar `package.json` y el checklist de cambios visuales. |
| `scripts/dev/render-all-retro-colors.js` | Genera un PNG por cada una de las 30 paletas `inCycle`, para revisión visual manual. Sin alias `npm run`. | Solo mencionado como `node scripts/dev/render-all-retro-colors.js` en `CLAUDE.md`, `README.md`, `docs/operations/scripts.md`. | render preview | Bajo-medio — no tiene alias que romper en `package.json`, solo referencias de texto en docs. | Seguro de mover más adelante si se decide; solo hay que actualizar 3 menciones en docs. |
| `scripts/dev/debug-layout-tmp.js` | Ayuda de diagnóstico: sirve un preview en `:8099` con Playwright y corre un set fijo de frases contra `getRetro3DLayoutDebug` para detectar overflow, saltos de tamaño de fuente y outliers en el layout retro3D. Se agregó y se mantuvo a propósito (commit `474aa69 "Keep retro3d layout debug helper"`) tras el rework del layout. | Sin alias `npm run`. Solo aparece en `docs/operations/scripts.md` (creado en la fase anterior) y en `.claude/settings.local.json` (config local no versionada, lo usa en un comando de limpieza de PNGs de prueba). | temporal/debug | Bajo — no tiene ninguna referencia en `README.md`/`CLAUDE.md`/`doctor.js`. | Es "temporal" de nombre pero se conservó a propósito como herramienta de regresión para el layout retro3D — no es basura para borrar sin más, pero sí es el candidato más claro a mover a una subcarpeta tipo `scripts/dev/debug/` en una fase futura, si se quiere. |
| `tools/archivo-x-curator.html` | **Eliminado en la Fase C5** (`git rm`). Era la UI legacy de curaduría ("Curaduría" + "Publicar carruseles"); en la Fase C3 dejó de ser el fallback visible, y en la C5 se borró del todo. La URL `/archivo-x-curator.html` sigue viva como redirect (302) a `panel.html#curate` en `archive-curator-server.js`. | Ya no aplica — el archivo no existe. Ver `docs/architecture/entrypoints.md` para el detalle histórico. | eliminado | — | Ya eliminado. Si algún día hiciera falta revertir, está en el historial de git (commit de la Fase C5). |

## Resumen por categoría

- **dev activo / diagnóstico:** `doctor.js`, `doctor-sheet.js`, `check-palettes-sync.js` — se corren seguido para validar el repo, todos de solo lectura o generación local.
- **paletas:** `sync-palettes.js` (escribe `js/palettes.js`), `check-palettes-sync.js` (solo compara).
- **render preview:** `render-preview.js`, `render-all-retro-colors.js` — generan PNGs locales en `/output`, no tocan el Sheet.
- **curaduría activa:** `archive-curator-server.js` — el archivo "delicado" que queda en esta
  carpeta, ya documentado aparte en `docs/architecture/entrypoints.md`.
- **temporal/debug:** `debug-layout-tmp.js` — el único sin ninguna referencia oficial en README/CLAUDE, pero conservado a propósito.
- **candidato a legacy:** ninguno. Los 8 archivos de `scripts/dev/` están en uso o son
  diagnóstico activo — no encontré código muerto real en esta auditoría. `tools/` quedó vacía
  desde la Fase C5.

## Qué NO se debe mover todavía

- `scripts/dev/archive-curator-server.js` — por las razones ya documentadas en
  `docs/architecture/entrypoints.md` (producción real vía Render).

## Seguro de mover en una fase futura (si se decide)

- `scripts/dev/render-all-retro-colors.js` y `scripts/dev/debug-layout-tmp.js` son los de menor
  riesgo para reorganizar (p.ej. a una subcarpeta `scripts/dev/debug/`), porque ninguno tiene
  alias en `package.json` ni está en `REQUIRED_FILES` de `doctor.js` — solo hay que actualizar un
  puñado de menciones en texto.

## Comandos recomendados por herramienta

```bash
npm run doctor               # validación general del repo (correr seguido)
npm run doctor:sheet         # auditar columnas/estados del Sheet real (solo lectura)
npm run sync-palettes        # después de editar scripts/config/retro-palettes.js
npm run check-palettes-sync  # verificar que sync-palettes no quedó pendiente
npm run render "texto" retro3d "#D4A017"   # preview rápido de una frase

node scripts/dev/render-all-retro-colors.js   # preview de las 30 paletas de una vez
node scripts/dev/debug-layout-tmp.js          # chequeo de regresión del layout retro3D (:8099)
```
