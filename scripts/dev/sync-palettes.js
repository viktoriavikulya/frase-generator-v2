#!/usr/bin/env node
/**
 * sync-palettes.js
 *
 * Fuente de verdad: scripts/config/retro-palettes.js
 *
 * Sincroniza las paletas a:
 *   1. js/palettes.js    — bloque RETRO_PALETTES (frontend / Playwright)
 *   2. publicar.html     — bloque COLORES (formulario GitHub Pages)
 *
 * Uso:
 *   node scripts/dev/sync-palettes.js
 *   npm run sync-palettes
 *
 * Cómo funciona:
 *   Busca los marcadores // RETRO_PALETTES_START / // RETRO_PALETTES_END en
 *   js/palettes.js, y // COLORES_START / // COLORES_END en publicar.html,
 *   y reemplaza el contenido entre ellos con los datos actuales de
 *   retro-palettes.js. Los marcadores deben existir en los archivos destino.
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const { RETRO_PALETTES } = require("../config/retro-palettes");

const ROOT        = path.resolve(__dirname, "../..");
const PALETTES_JS = path.join(ROOT, "js", "palettes.js");
const PUBLICAR    = path.join(ROOT, "publicar.html");

// ── 1. js/palettes.js ────────────────────────────────────────────────────────

replaceMarkedBlock(
  PALETTES_JS,
  "RETRO_PALETTES_START",
  "RETRO_PALETTES_END",
  buildPalettesBlock()
);

console.log("✔  js/palettes.js actualizado");

// ── 2. publicar.html — COLORES ───────────────────────────────────────────────

replaceMarkedBlock(
  PUBLICAR,
  "COLORES_START",
  "COLORES_END",
  buildColoresBlock()
);

console.log("✔  publicar.html actualizado");
console.log(`\n   ${RETRO_PALETTES.length} paletas sincronizadas.`);

// ── Builders ─────────────────────────────────────────────────────────────────

function buildPalettesBlock() {
  const rows = RETRO_PALETTES.map((p) => {
    const pc = p.patternColor === null ? "null     " : `"${p.patternColor}"`;
    return (
      `  { id: "${p.id}",`.padEnd(24) +
      ` bg: "${p.bg}", frontColor: "${p.frontColor}", midColor: "${p.midColor}",` +
      ` shadowColor: "${p.shadowColor}", patternColor: ${pc},` +
      ` patternAlpha: ${p.patternAlpha.toFixed(2)}, inCycle: ${p.inCycle} }`
    );
  });

  return `const RETRO_PALETTES = [\n${rows.join(",\n")},\n];`;
}

function buildColoresBlock() {
  const rows = RETRO_PALETTES.map(
    (p) => `    { hex: "${p.bg}", label: "${p.id}" },`
  );

  return [
    "  const COLORES = [",
    '    { hex: null,      label: "Aleatorio" },',
    ...rows,
    "  ];",
  ].join("\n");
}

// ── replaceMarkedBlock ───────────────────────────────────────────────────────

function replaceMarkedBlock(filePath, startTag, endTag, newContent) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Archivo no encontrado: ${filePath}`);
  }

  const original    = fs.readFileSync(filePath, "utf8");
  const startMarker = `// ${startTag}`;
  const endMarker   = `// ${endTag}`;

  const startIdx = original.indexOf(startMarker);
  const endIdx   = original.indexOf(endMarker);

  if (startIdx === -1) {
    throw new Error(
      `Marcador "${startMarker}" no encontrado en ${path.basename(filePath)}.\n` +
      `Agrega el comentario exactamente como:\n  // ${startTag}\n  ...contenido...\n  // ${endTag}`
    );
  }

  if (endIdx === -1) {
    throw new Error(
      `Marcador "${endMarker}" no encontrado en ${path.basename(filePath)}.\n` +
      `Agrega el comentario exactamente como:\n  // ${startTag}\n  ...contenido...\n  // ${endTag}`
    );
  }

  if (endIdx <= startIdx) {
    throw new Error(
      `El marcador END aparece antes que START en ${path.basename(filePath)}.`
    );
  }

  const before  = original.slice(0, startIdx + startMarker.length);
  const after   = original.slice(endIdx);
  const updated = `${before}\n${newContent}\n${after}`;

  fs.writeFileSync(filePath, updated, "utf8");
}