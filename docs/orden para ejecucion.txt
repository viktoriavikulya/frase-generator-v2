# Ejecución manual (desarrollo local)

## 1. Servidor de render
No hace falta levantarlo manualmente para el pipeline: `render-lib.js` arranca un servidor local automáticamente en `GENERATOR_PORT` (por defecto 5173) si no hay uno corriendo.

Si querés abrir el generador visual a mano:
npx http-server . -p 5173

## 2. Correr el pipeline
En otra terminal:

# Pipeline completo (auto: carousel primero, cae a single si no hay)
node scripts/pipeline/run-once.js

# Solo un tipo específico
TIPO_INPUT=carousel node scripts/pipeline/run-once.js
TIPO_INPUT=single   node scripts/pipeline/run-once.js

## 3. Herramientas de desarrollo

# Previsualiza la frase con todas las paletas de color
node scripts/dev/render-all-retro-colors.js

# Preview rápido de una sola frase con un color específico
node scripts/dev/render-preview.js

## 4. Otros

# Sincronizar paletas después de editar retro-palettes.js
npm run sync-palettes

# Diagnosticar el repo localmente
npm run doctor

# Auditar columnas y estados del Google Sheet
npm run doctor:sheet

# Buscar inspiración viral y guardarla en la pestaña "inspiracion"
npm run fetch:inspiration

# Importar el archivo local de X al tablero editorial del Sheet
# Entrada por defecto: data/tweets-guardados-x.txt
# Pestaña destino por defecto: archivo_x
# Columnas principales para revisar, en este orden:
# sirve -> estado -> prioridad -> grupo_carrusel -> frase_final -> notas
# Deja frase_original como referencia. calidad/riesgo/temporada son apoyo, no edición principal.
npm run import:saved-tweets

# Abrir interfaz local para clasificar archivo_x frase por frase
# Guarda directo en el Sheet y marca clasificado_manual=si.
npm run curate:archivo-x

# Generar plan de carruseles desde archivo_x
# Usa approved, luego rewrite_needed, y luego rejects rescatables con needs_review=true.
# Solo genera grupos con 8 a 10 slides y actualiza la pestaña "plan_carruseles".
# Columnas principales para revisar:
# usar -> estado -> revisar -> grupo -> orden -> frase_final -> notas
npm run build:carousel-plan

# Probar inspiración sin guardar nada
$env:INSPIRATION_DRY_RUN="true"; npm run fetch:inspiration

# Si X responde sin créditos, usar solo Bluesky en PowerShell
$env:INSPIRATION_SOURCE="bluesky"; npm run fetch:inspiration

# Modo viral: menos candidatos, más señal de engagement
$env:INSPIRATION_QUALITY_MODE="viral"; npm run fetch:inspiration

# Modo exploración: más candidatos, menos exigente
$env:INSPIRATION_QUALITY_MODE="explore"; npm run fetch:inspiration

# Ajustar filtros manualmente si salen pocas o demasiadas frases
$env:INSPIRATION_MIN_LIKES="20"; $env:INSPIRATION_MIN_SCORE="30"; npm run fetch:inspiration

# Si Bluesky público responde 403, configurar en .env:
# BLUESKY_IDENTIFIER=tu_usuario.bsky.social
# BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx

# Generar resumen del repo
npx repomix@latest
