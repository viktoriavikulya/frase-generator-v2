# Ejecucion Manual Y Operacion

## Panel Local

```bash
# Terminal 1: API de Archivo X
npm run curate:archivo-x

# Terminal 2: panel
npm run panel
```

Abrir:

```text
http://localhost:5173/panel.html
```

No abrir `panel.html` con `file://`.

## Flujo Operativo Recomendado

- Publicar: `Publicar Ahora`.
- Guardar sin publicar: `Publicar Ahora` -> guardar en Sheet.
- Reintentar errores: `Operaciones` -> `Reintentar ahora`.
- Republicar sin re-renderizar: `Operaciones` -> pegar `row_id` o `carousel_id`.
- Desbloquear fila: `Operaciones` -> pegar ID y confirmar.
- Ver ejecucion: abrir GitHub Actions o el run recien disparado desde el enlace del panel.

El panel dispara `publish.yml` con `repository_dispatch` (`event_type: publish-posts`). `publish.yml` ya no tiene `workflow_dispatch`; no usar **Run workflow** manual como flujo normal.

## Pipeline Local

```bash
# Pipeline completo local (auto: carousel primero, cae a single si no hay)
node scripts/pipeline/run-once.js

# Solo un tipo especifico
TIPO_INPUT=carousel node scripts/pipeline/run-once.js
TIPO_INPUT=single   node scripts/pipeline/run-once.js
```

## Render Y Preview

```bash
# Preview rapido de una frase
npm run render

# Previsualizar paletas
node scripts/dev/render-all-retro-colors.js
```

El motor real de render es `panel.html?renderEngine=1`. `index.html` ya no existe.

## Curaduria E Inspiracion

```bash
# Importar archivo local de X al tablero editorial
npm run import:saved-tweets

# Buscar inspiracion viral
npm run fetch:inspiration

# API local de Archivo X
npm run curate:archivo-x
```

El flujo editorial activo vive en el panel:
- Agregar Frases
- Curar Frases
- Armar Carruseles

`tools/archivo-x-curator.html` fue eliminado; Render solo sirve APIs y redirects legacy.

## Diagnostico

```bash
npm run doctor
npm run doctor:sheet
```

Antes de tocar `publish.yml`, correr `npm run doctor` y validar un disparo `repository_dispatch` desde el panel.

## Paletas

```bash
npm run sync-palettes
npm run check-palettes-sync
```

## Repomix

```bash
npx repomix@latest
```
