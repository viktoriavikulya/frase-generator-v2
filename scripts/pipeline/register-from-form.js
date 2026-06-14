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

function normalizePhraseForDedupe(value) {
  return (value || "")
    .toString()
    .normalize("NFD")
    .replace(/[\p{M}]/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findDuplicatePhrases({ rows, headerMap, tipo, frases }) {
  const inputSet = new Map();

  frases.forEach((frase, index) => {
    const normalized = normalizePhraseForDedupe(frase);
    if (normalized && !inputSet.has(normalized)) {
      inputSet.set(normalized, { frase, index });
    }
  });

  const duplicates = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1;

    const postTipo = getCellValue(row, headerMap, "post_tipo").toLowerCase();
    if (postTipo !== tipo) continue;

    const estadoGeneral = getCellValue(row, headerMap, "estado_general").toLowerCase();
    if (estadoGeneral === "discarded" || estadoGeneral === "cancelled") continue;

    const existingPhrase = getCellValue(row, headerMap, "frase_corregida") ||
      getCellValue(row, headerMap, "frase_original");
    const normalized = normalizePhraseForDedupe(existingPhrase);

    if (!inputSet.has(normalized)) continue;

    duplicates.push({
      rowNumber,
      rowId: "row_id" in headerMap ? getCellValue(row, headerMap, "row_id") : "",
      frase: inputSet.get(normalized).frase,
      estadoGeneral
    });
  }

  return duplicates;
}

/**
 * Registra `frases` como filas "pending" en la hoja, a partir de la primera
 * fila vacía. No depende de process.env ni de GitHub Actions — puede usarse
 * desde cualquier contexto (workflow, servidor del curador, etc.).
 *
 * @returns {{ carouselId: string, nextRow: number, rowIds: string[] }}
 * @throws si `tipo` es inválido, la cantidad de frases no corresponde al
 *         tipo, faltan columnas requeridas en la hoja, o se detectan frases
 *         duplicadas (a menos que `allowDuplicate` sea true).
 */
async function registerFrases(sheets, { tipo, frases, caption, colorInput = "", allowDuplicate = false }) {
  if (!["single", "carousel"].includes(tipo)) {
    throw new Error(`tipo inválido: ${tipo}. Usa "single" o "carousel".`);
  }

  validateFrasesByTipo(tipo, frases);

  const rows      = await readRows(sheets);
  const headers   = rows[0];
  const headerMap = buildHeaderMap(headers);

  const requiredHeaders = [
    "row_id",
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

  if (!allowDuplicate) {
    const duplicates = findDuplicatePhrases({ rows, headerMap, tipo, frases });

    if (duplicates.length > 0) {
      logger.error("Registro cancelado por frase duplicada", { tipo, duplicates });
      throw new Error(
        `Frase duplicada detectada (${tipo}). ` +
        `Primera coincidencia en fila ${duplicates[0].rowNumber}. ` +
        `Si realmente quieres repetirla, usa ALLOW_DUPLICATE=true.`
      );
    }
  }

  const carouselId = tipo === "carousel" ? generateCarouselId() : "";
  const nextRow    = findNextEmptyRow(rows, headerMap);

  logger.info("Primera fila vacía detectada", { nextRow });

  const hashtags = "#monacastrosa #frasesreales #humorcotidiano #vidareal";
  const now      = nowIsoLocal();
  const updates  = [];
  const rowIds   = [];

  frases.forEach((frase, i) => {
    const row = nextRow + i;
    const rowId = randomUUID();
    rowIds.push(rowId);

    const add = (field, value) => {
      if (headerMap[field] !== undefined) {
        updates.push({ row, col: headerMap[field] + 1, value });
      }
    };

    // FIX: crypto.randomUUID() garantiza unicidad real por fila.
    // El patrón anterior ${Date.now()}_${i} generaba IDs idénticos si dos
    // registros corrían en el mismo milisegundo (posible en GitHub Actions).
    add("row_id", rowId);
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

  return { carouselId, nextRow, rowIds };
}

async function main() {
  const frasesRaw  = process.env.FRASES_INPUT  || "";
  const caption    = process.env.CAPTION_INPUT  || "";
  const tipoRaw    = process.env.TIPO_INPUT     || "carousel";
  const colorInput = process.env.COLOR_INPUT    || "";
  const allowDuplicate = process.env.ALLOW_DUPLICATE === "true";

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

  logger.info(`Registrando frases`, { count: frases.length, tipo, caption });

  const sheets = await getSheetsClient();

  const { carouselId, nextRow } = await registerFrases(sheets, { tipo, frases, caption, colorInput, allowDuplicate });

  if (tipo === "carousel" && process.env.GITHUB_ENV) {
    const fs = require("fs");
    fs.appendFileSync(process.env.GITHUB_ENV, `TARGET_CAROUSEL_ID=${carouselId}\n`);
  }

  if (tipo === "single" && process.env.GITHUB_ENV) {
    const fs = require("fs");
    fs.appendFileSync(process.env.GITHUB_ENV, `TARGET_ROW_NUMBER=${nextRow}\n`);
  }

  if (tipo === "carousel") {
    logger.info("Frases registradas como pending", { count: frases.length, carouselId, nextRow });
  } else {
    logger.info("Frases registradas como pending", { count: frases.length, tipo: "single", nextRow });
  }
}

module.exports = { registerFrases };

if (require.main === module) {
  main().catch(err => {
    logger.error("Error registrando frases", {}, err);
    process.exit(1);
  });
}
