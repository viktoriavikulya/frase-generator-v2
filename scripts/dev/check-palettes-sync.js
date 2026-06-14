#!/usr/bin/env node
/**
 * check-palettes-sync.js
 *
 * Verifica que js/palettes.js esté sincronizado con scripts/config/retro-palettes.js.
 * Falla con exit(1) si hay diferencias — úsalo en CI antes de un deploy o merge.
 *
 * Uso:
 *   node scripts/dev/check-palettes-sync.js
 *   npm run check-palettes-sync    ← agregar a package.json si querés
 */

"use strict";

const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

// Fuente de verdad: backend
const { RETRO_PALETTES: SOURCE } = require("../config/retro-palettes");

// Frontend: las paletas viven en el scope global del browser, pero podemos
// extraerlas del archivo parseando el bloque marcado.
const fs = require("fs");
const frontendSrc = fs.readFileSync(path.join(ROOT, "js", "palettes.js"), "utf8");

// Extraer el JSON del bloque marcado
const startMarker = "// RETRO_PALETTES_START";
const endMarker   = "// RETRO_PALETTES_END";
const startIdx    = frontendSrc.indexOf(startMarker);
const endIdx      = frontendSrc.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error("ERROR: No se encontraron los marcadores RETRO_PALETTES_START/END en js/palettes.js");
  process.exit(1);
}

const block = frontendSrc.slice(startIdx + startMarker.length, endIdx).trim();

// Evaluar el bloque para obtener el array (contexto seguro — solo datos propios)
let FRONTEND_PALETTES;
try {
  // eslint-disable-next-line no-new-func
  FRONTEND_PALETTES = new Function(`${block}; return RETRO_PALETTES;`)();
} catch (err) {
  console.error("ERROR: No se pudo parsear RETRO_PALETTES de js/palettes.js:", err.message);
  process.exit(1);
}

// Comparar
let hasError = false;

if (SOURCE.length !== FRONTEND_PALETTES.length) {
  console.error(`DESINCRONIZADO: backend tiene ${SOURCE.length} paletas, frontend tiene ${FRONTEND_PALETTES.length}`);
  hasError = true;
}

for (let i = 0; i < SOURCE.length; i++) {
  const src  = SOURCE[i];
  const dest = FRONTEND_PALETTES[i];

  if (!dest) {
    console.error(`FALTA en frontend: paleta[${i}] id="${src.id}"`);
    hasError = true;
    continue;
  }

  const keys = ["id", "bg", "frontColor", "midColor", "shadowColor", "patternColor", "patternAlpha", "inCycle"];
  for (const key of keys) {
    if (src[key] !== dest[key]) {
      console.error(`DIFERENCIA en "${src.id}" — campo "${key}": backend=${JSON.stringify(src[key])} / frontend=${JSON.stringify(dest[key])}`);
      hasError = true;
    }
  }
}

if (hasError) {
  console.error("\nLas paletas están desincronizadas. Ejecutá: npm run sync-palettes");
  process.exit(1);
}

console.log(`OK: ${SOURCE.length} paletas sincronizadas entre backend y frontend.`);
process.exit(0);