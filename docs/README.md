# Documentación del proyecto

Índice de toda la documentación en `docs/`. Si es tu primera vez en el repo, o volviste después
de un tiempo y no te acordás dónde estaba explicado algo, empezá acá.

Para el mapa completo de arquitectura/pipeline/modelo de datos, la referencia principal sigue
siendo [`CLAUDE.md`](../CLAUDE.md) en la raíz del repo. Lo de acá abajo es documentación
complementaria, más operativa.

## Lectura recomendada (en este orden)

1. [`architecture/entrypoints.md`](architecture/entrypoints.md) — qué es cada HTML de la raíz
   (`panel.html`, `index.html`, `publicar.html`) y cuáles se pueden mover.
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
