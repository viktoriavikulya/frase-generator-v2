require("dotenv").config();

const { randomUUID } = require("crypto");
const {
  getSheetsClient,
  buildHeaderMap,
  requireHeaders,
  getCellValue,
  readRows,
  updateCellsBatch
} = require("../core/sheets");

const { nowIsoLocal } = require("../utils/common");
const { logger } = require("../utils/logger");

/**
 * Genera un ID único para un carrusel.
 *
 * FIX: la versión anterior calculaba un hash del contenido de las frases y
 * lo combinaba con Date.now(). El hash era inútil (Date.now() ya lo hacía
 * único) y generaba colisiones si dos registros ocurrían en el mismo
 * milisegundo con el mismo contenido. Ahora usa crypto.randomUUID(), que
 * garantiza unicidad sin depender del tiempo ni del contenido.
 */
function generateCarouselId() {
  // "car_" + primeros 12 chars del UUID sin guiones → legible en el sheet
  return "car_" + randomUUID().replace(/-/g, "").slice(0, 12);
}

/**
 * Retorna el número de fila (1-based, contando header) donde escribir las
 * nuevas frases — es decir, la primera fila completamente vacía al final
 * del bloque de datos.
 *
 * Estrategia: recorremos de atrás hacia adelante buscando la última fila que
 * tenga al menos un valor en las columnas clave. La fila siguiente a esa es
 * donde empezamos a escribir.
 *
 * Esto es más robusto que buscar solo frase_original porque:
 *   - Una fila puede tener frase_original vacía pero tener datos en otras
 *     columnas (estado, lock, etc.) por ediciones manuales o errores previos.
 *   - Si solo miramos frase_original podríamos sobrescribir esas filas.
 *
 * Columnas que se consideran para determinar si una fila "tiene datos":
 * son las mismas que escribe este script — si alguna tiene valor, la fila
 * no está vacía.
 */
const KEY_COLUMNS = [
  "frase_original",
  "frase_corregida",
  "estado_general",
  "estado_render",
  "estado_upload",
  "estado_publish",
  "lock_status"
];

function findNextEmptyRow(rows, headerMap) {
  // Columnas a revisar: solo las que existen en el headerMap
  const colsToCheck = KEY_COLUMNS.filter(col => col in headerMap);

  for (let i = rows.length - 1; i >= 1; i--) {
    const row = rows[i];

    const hasData = colsToCheck.some(col => {
      const value = getCellValue(row, headerMap, col);
      return value !== "";
    });

    if (hasData) {
      // Esta fila tiene datos — la siguiente es la primera vacía
      return i + 2; // +1 por base-1 de Sheets, +1 para ir a la siguiente
    }
  }

  // La hoja solo tiene el header
  return 2;
}

function validateFrasesByTipo(tipo, frases) {
  if (tipo === "single" && frases.length !== 1) {
    throw new Error(
      `Para tipo "single" debes enviar exactamente 1 frase. Recibidas: ${frases.length}.`
    );
  }

  if (tipo === "carousel" && (frases.length < 2 || frases.length > 10)) {
    throw new Error(
      `Para tipo "carousel" debes enviar entre 2 y 10 frases. Recibidas: ${frases.length}.`
    );
  }
}

async function main() {
  const frasesRaw  = process.env.FRASES_INPUT  || "";
  const caption    = process.env.CAPTION_INPUT  || "";
  const tipoRaw    = process.env.TIPO_INPUT     || "carousel";
  const colorInput = process.env.COLOR_INPUT    || "";

  if (!["single", "carousel"].includes(tipoRaw)) {
    throw new Error(`TIPO_INPUT inválido: ${tipoRaw}. Usa "single" o "carousel".`);
  }

  const tipo = tipoRaw;

  const frases = frasesRaw
    .split("||")
    .map((f) => f.trim())
    .filter(Boolean);

  if (frases.length < 1) {
    logger.info("No hay frases suficientes, nada que registrar.");
    process.exit(0);
  }

  validateFrasesByTipo(tipo, frases);

  logger.info(`Registrando frases`, { count: frases.length, tipo, caption });

  const sheets    = await getSheetsClient();
  const rows      = await readRows(sheets);
  const headers   = rows[0];
  const headerMap = buildHeaderMap(headers);

  const requiredHeaders = [
    "frase_original", "frase_corregida", "post_tipo", "hashtags",
    "estado_general", "estado_render", "estado_upload", "estado_publish",
    "lock_status", "modo", "updated_at"
  ];

  if (tipo === "carousel") {
    requiredHeaders.push("carousel_id", "carousel_order", "carousel_caption");
  } else {
    requiredHeaders.push("caption");
  }

  requireHeaders(headerMap, requiredHeaders);

  const carouselId = tipo === "carousel" ? generateCarouselId() : "";
  const nextRow    = findNextEmptyRow(rows, headerMap);

  logger.info("Primera fila vacía detectada", { nextRow });

  if (tipo === "carousel" && process.env.GITHUB_ENV) {
    const fs = require("fs");
    fs.appendFileSync(process.env.GITHUB_ENV, `TARGET_CAROUSEL_ID=${carouselId}\n`);
  }

  if (tipo === "single" && process.env.GITHUB_ENV) {
    const fs = require("fs");
    fs.appendFileSync(process.env.GITHUB_ENV, `TARGET_ROW_NUMBER=${nextRow}\n`);
  }

  const hashtags = "#monacastrosa #frasesreales #humorcotidiano #vidareal";
  const now      = nowIsoLocal();
  const updates  = [];

  frases.forEach((frase, i) => {
    const row = nextRow + i;
    const add = (field, value) => {
      if (headerMap[field] !== undefined) {
        updates.push({ row, col: headerMap[field] + 1, value });
      }
    };

    // FIX: crypto.randomUUID() garantiza unicidad real por fila.
    // El patrón anterior ${Date.now()}_${i} generaba IDs idénticos si dos
    // registros corrían en el mismo milisegundo (posible en GitHub Actions).
    add("row_id", randomUUID());
    add("frase_original", frase);
    add("frase_corregida", frase);
    add("post_tipo", tipo);
    add("hashtags", hashtags);
    add("estado_general", "pending");
    add("estado_render", "pending");
    add("estado_upload", "pending");
    add("estado_publish", "pending");
    add("lock_status", "free");
    add("modo", "retro3d");
    if (colorInput) add("background_color", colorInput);
    add("updated_at", now);

    if (tipo === "carousel") {
      add("carousel_id", carouselId);
      add("carousel_order", i + 1);
      add("carousel_caption", caption);
    } else {
      add("caption", caption);
    }
  });

  await updateCellsBatch(sheets, updates);

  if (tipo === "carousel") {
    logger.info("Frases registradas como pending", { count: frases.length, carouselId, nextRow });
  } else {
    logger.info("Frases registradas como pending", { count: frases.length, tipo: "single", nextRow });
  }
}

main().catch(err => {
  logger.error("Error registrando frases", {}, err);
  process.exit(1);
});