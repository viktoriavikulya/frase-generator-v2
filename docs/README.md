# Documentación del proyecto

Índice de toda la documentación en `docs/`. Si es tu primera vez en el repo, o volviste después
de un tiempo y no te acordás dónde estaba explicado algo, empezá acá.

Para el mapa completo de arquitectura/pipeline/modelo de datos, la referencia principal sigue
siendo [`CLAUDE.md`](../CLAUDE.md) en la raíz del repo. Lo de acá abajo es documentación
complementaria, más operativa.

## Estado actual

- Entrada oficial: `https://imgifra.github.io/frase-generator-v2/panel.html`.
- Unico HTML versionado: `panel.html`.
- Motor de render: `panel.html?renderEngine=1`.
- `publish.yml` se dispara por `schedule` y `repository_dispatch` (`event_type: publish-posts`).
- `metrics.yml` se dispara por `schedule` semanal (`0 15 * * 0`, domingo ~10:00 a.m. Colombia) y
  `repository_dispatch` (`event_type: update-metrics`) desde `panel.html#operations` →
  "Actualizar métricas" (input `Días a consultar`, default 30, rango 1-365).
- `workflow_dispatch` fue eliminado de `publish.yml` y de `metrics.yml`; no usar **Run workflow**
  manual como flujo normal. Publish Posts y Actualizar Métricas se operan desde
  `panel.html#operations`.
- `panel.html#operations` incluye "Historial de ejecuciones" ("Actualizar historial"): hasta 10
  runs recientes mezclados de `publish.yml` y `metrics.yml`, sin filtro de event/branch — incluye
  `repository_dispatch`, `schedule` e históricos (pueden aparecer `workflow_dispatch` viejos).
  Requiere el token del panel; fine-grained PAT necesita `Actions: read` para esta lectura.
- Tags estables: `v-panel-unico-stable`, `v-panel-operations-stable`,
  `v-panel-repository-dispatch-stable`, `v-panel-repository-dispatch-docs`,
  `v-panel-operations-metrics-stable`, `v-panel-operations-history-stable`.

## Lectura recomendada (en este orden)

1. [`architecture/entrypoints.md`](architecture/entrypoints.md) — qué es `panel.html` (la única
   página HTML principal, y con `?renderEngine=1` también el motor de render) y el histórico de
   HTML eliminados.
2. [`architecture/mapa-del-proyecto.md`](architecture/mapa-del-proyecto.md) — cómo se conectan
   las piezas, mapa de riesgo por tipo de cambio, checklist antes de modificar código.
3. [`operations/scripts.md`](operations/scripts.md) — inventario de todos los comandos
   (`npm run ...` y `node ...`), qué hace cada uno, riesgo, y cuáles publican/escriben de verdad.
4. [`operations/dev-tools.md`](operations/dev-tools.md) — detalle archivo por archivo de
   `scripts/dev/` y `tools/`.
5. [`operations/generated-artifacts.md`](operations/generated-artifacts.md) — qué carpetas son
   artefactos generados/exports vs. código real, y qué no se debe versionar nunca.
6. [`operations/orden-para-ejecucion.md`](operations/orden-para-ejecucion.md) — comandos sueltos
   para ejecución manual en desarrollo local.
7. [`roadmap/que-hacer-en-el-futuro.md`](roadmap/que-hacer-en-el-futuro.md) — qué está
   completado, qué sigue, e ideas futuras.

## Según lo que quieras hacer

- "Quiero abrir el panel local" → [`operations/scripts.md`](operations/scripts.md) (sección
  "Comandos de uso diario") y [`operations/orden-para-ejecucion.md`](operations/orden-para-ejecucion.md).
- "Quiero saber qué HTML se usa y cuál es legacy/fallback" →
  [`architecture/entrypoints.md`](architecture/entrypoints.md).
- "Quiero saber qué comandos son peligrosos (publican, suben imágenes, tocan el Sheet real)" →
  [`operations/scripts.md`](operations/scripts.md).
- "Quiero saber qué archivos no versionar o dónde van los exports/dumps" →
  [`operations/generated-artifacts.md`](operations/generated-artifacts.md).
- "Quiero entender qué hace cada script de `scripts/dev/`" →
  [`operations/dev-tools.md`](operations/dev-tools.md).
- "Quiero ver riesgos y checklist antes de tocar código" →
  [`architecture/mapa-del-proyecto.md`](architecture/mapa-del-proyecto.md).
- "Quiero ver pendientes o ideas futuras" →
  [`roadmap/que-hacer-en-el-futuro.md`](roadmap/que-hacer-en-el-futuro.md).

## Por categoría

### Arquitectura

- [`architecture/entrypoints.md`](architecture/entrypoints.md)
- [`architecture/mapa-del-proyecto.md`](architecture/mapa-del-proyecto.md)

### Operación diaria

- [`operations/scripts.md`](operations/scripts.md)
- [`operations/orden-para-ejecucion.md`](operations/orden-para-ejecucion.md)

### Mantenimiento y artefactos

- [`operations/dev-tools.md`](operations/dev-tools.md)
- [`operations/generated-artifacts.md`](operations/generated-artifacts.md)

### Roadmap / futuro

- [`roadmap/que-hacer-en-el-futuro.md`](roadmap/que-hacer-en-el-futuro.md)
