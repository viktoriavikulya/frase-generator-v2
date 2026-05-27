require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { SHEET_ID, getSheetsClient, buildHeaderMap } = require("../../core/sheets");
const { colToLetter, nowIsoLocal } = require("../../utils/common");
const { logger } = require("../../utils/logger");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_INPUT = path.join(ROOT, "data", "tweets-guardados-x.txt");

const WORKSHEET_NAME = process.env.SAVED_TWEETS_WORKSHEET_NAME || "archivo_x";
const INPUT_PATH = path.resolve(process.env.SAVED_TWEETS_INPUT || DEFAULT_INPUT);
const ONE_PER_LINE = parseBool(process.env.SAVED_TWEETS_ONE_PER_LINE, true);
const DRY_RUN = parseBool(process.env.SAVED_TWEETS_DRY_RUN, false);
const IMPORT_LIMIT = clampNumber(Number(process.env.SAVED_TWEETS_IMPORT_LIMIT || 0), 0, 10000);

/**
 * NUEVA ESTRUCTURA DE COLUMNAS (Flujo 100% manual)
 * El importador SOLO agrega frases crudas sin clasificación automática.
 * Todas las decisiones editoriales son hechas manualmente en el curador.
 * 
 * decision_editorial puede ser: "pendiente", "aprobada", "descartada"
 * temporalidad puede ser: "atemporal", "temporada", "coyuntural", "fecha_especial"
 */
const HEADERS = [
  "id",
  "frase_original",
  "frase_final",
  "decision_editorial",
  "grupo_carrusel",
  "notas",
  "temporalidad",
  "temporada",
  "capturado_en",
  "actualizado_en",
  "lote_importacion",
  "fuente",
  // Columnas legacy (deprecadas, mantenidas por compatibilidad)
  "sirve",
  "estado",
  "prioridad",
  "accion",
  "recomendacion_auto",
  "calidad",
  "riesgo",
  "subtema",
  "clasificado_manual"
];

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "si", "s"].includes(String(value).toLowerCase());
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Utilidades de normalización simplificadas (SIN lógica de scoring)
 */
function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripEntryNoise(value) {
  return normalizeText(value)
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/\S+$/gim, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForDedup(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function splitEntries(content, onePerLine) {
  const normalized = normalizeText(content);
  const blocks = normalized.split(/\n{2,}/).map(stripEntryNoise).filter(Boolean);

  if (!onePerLine && blocks.length >= 10) {
    return blocks;
  }

  return normalized.split("\n").map(stripEntryNoise).filter(Boolean);
}

function buildArchiveId(text) {
  const key = normalizeForDedup(text);
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 12);
  return `x_${hash}`;
}

function getImportBatch() {
  return `x_${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}`;
}

function cell(row, headerMap, key) {
  const index = headerMap[key];
  if (index === undefined) return "";
  return String(row?.[index] || "").trim();
}

function cellFromAny(row, headerMap, keys) {
  for (const key of keys) {
    const value = cell(row, headerMap, key);
    if (value) return value;
  }
  return "";
}

async function ensureWorksheet(sheets) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: "sheets.properties.title"
  });

  const exists = (meta.data.sheets || []).some(sheet => sheet.properties?.title === WORKSHEET_NAME);

  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: WORKSHEET_NAME
            }
          }
        }
      ]
    }
  });
}

async function readArchiveRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${WORKSHEET_NAME}!A:AZ`
  }).catch(err => {
    if (err.code === 400 || err.code === 404) return { data: { values: [] } };
    throw err;
  });

  return res.data.values || [];
}

async function getWorksheetId(sheets) {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: "sheets.properties"
  });

  const sheet = (res.data.sheets || []).find((item) => (
    item.properties?.title === WORKSHEET_NAME
  ));

  if (!sheet) {
    throw new Error(`No existe la pestaña "${WORKSHEET_NAME}"`);
  }

  return sheet.properties.sheetId;
}

function hasExpectedHeaderRow(headers) {
  return headers[0] === "id" && headers[1] === "frase_original";
}

async function insertHeaderRow(sheets) {
  const sheetId = await getWorksheetId(sheets);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          insertDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: 0,
              endIndex: 1
            },
            inheritFromBefore: false
          }
        }
      ]
    }
  });
}

async function ensureHeaders(sheets, rows) {
  const currentHeaders = (rows[0] || []).map(header => String(header || "").trim());

  if (rows.length > 0 && !hasExpectedHeaderRow(currentHeaders)) {
    await insertHeaderRow(sheets);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${WORKSHEET_NAME}!A1:${colToLetter(HEADERS.length)}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [HEADERS]
      }
    });

    return [HEADERS, ...rows];
  }

  const existing = new Set(currentHeaders.filter(Boolean));
  const mergedHeaders = [...currentHeaders];

  for (const header of HEADERS) {
    if (!existing.has(header)) {
      mergedHeaders.push(header);
      existing.add(header);
    }
  }

  if (rows.length === 0 || mergedHeaders.length !== currentHeaders.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${WORKSHEET_NAME}!A1:${colToLetter(mergedHeaders.length)}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [mergedHeaders]
      }
    });

    return [mergedHeaders, ...rows.slice(1)];
  }

  return rows;
}

function buildExistingIndexes(rows, headerMap) {
  const archiveIds = new Set();
  const textKeys = new Set();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const archiveId = cellFromAny(row, headerMap, ["id", "archive_id", "source_id"]);
    const textKey = normalizeForDedup(cellFromAny(row, headerMap, ["frase_original", "source_text"]));

    if (archiveId) archiveIds.add(archiveId);
    if (textKey) textKeys.add(textKey);
  }

  return { archiveIds, textKeys };
}

function buildRowEntry(originalText, headerMap, importBatch, capturedAt) {
  const width = Math.max(...Object.values(headerMap)) + 1;
  const values = Array(width).fill("");
  const archiveId = buildArchiveId(originalText);

  const set = (field, value) => {
    if (headerMap[field] !== undefined) {
      values[headerMap[field]] = value ?? "";
    }
  };

  // Nuevas columnas (flujo manual)
  set("id", archiveId);
  set("frase_original", originalText);
  set("frase_final", "");  // Vacío hasta curaduría
  set("decision_editorial", "pendiente");  // SIEMPRE pendiente al importar
  set("grupo_carrusel", "");  // Vacío hasta curaduría
  set("notas", "");
  set("temporalidad", "atemporal");  // Default, puede cambiar en curador
  set("temporada", "");
  set("capturado_en", capturedAt);
  set("actualizado_en", "");
  set("lote_importacion", importBatch);
  set("fuente", "tweets-guardados-x");

  // Columnas legacy (para compatibilidad, vacías)
  set("sirve", "");
  set("estado", "");
  set("prioridad", "");
  set("accion", "");
  set("recomendacion_auto", "");
  set("calidad", "");
  set("riesgo", "");
  set("subtema", "");
  set("clasificado_manual", "");

  return values;
}

async function appendRows(sheets, headerMap, entries) {
  if (!entries.length) return;

  const capturedAt = nowIsoLocal();
  const importBatch = getImportBatch();
  const values = entries.map(text => buildRowEntry(text, headerMap, importBatch, capturedAt));
  const width = Math.max(...values.map(row => row.length), HEADERS.length);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${WORKSHEET_NAME}!A:${colToLetter(width)}`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values
    }
  });
}

function readAndProcessInput() {
  if (!fs.existsSync(INPUT_PATH)) {
    throw new Error(`No existe el archivo de entrada: ${INPUT_PATH}`);
  }

  const raw = fs.readFileSync(INPUT_PATH, "utf8");
  const entries = splitEntries(raw, ONE_PER_LINE);
  const seen = new Set();
  const toImport = [];
  let duplicateInFile = 0;

  entries.forEach((entry, index) => {
    const key = normalizeForDedup(entry);
    if (!key) return;

    if (seen.has(key)) {
      duplicateInFile += 1;
      return;
    }

    seen.add(key);
    toImport.push(entry);
  });

  return {
    entries,
    toImport,
    duplicateInFile
  };
}

async function main() {
  const log = logger.child({ job: "import-saved-tweets", worksheet: WORKSHEET_NAME });

  if (!SHEET_ID) {
    throw new Error("Falta SHEET_ID en el .env");
  }

  const { entries, toImport, duplicateInFile } = readAndProcessInput();
  const selected = IMPORT_LIMIT ? toImport.slice(0, IMPORT_LIMIT) : toImport;

  log.info("Archivo X procesado", {
    input: INPUT_PATH,
    read: entries.length,
    unique: toImport.length,
    toImport: selected.length,
    duplicateInFile,
    dryRun: DRY_RUN,
    importLimit: IMPORT_LIMIT
  });

  const sheets = await getSheetsClient();
  await ensureWorksheet(sheets);
  let rows = await readArchiveRows(sheets);
  rows = await ensureHeaders(sheets, rows);

  const headerMap = buildHeaderMap(rows[0]);
  const { archiveIds, textKeys } = buildExistingIndexes(rows, headerMap);

  // Filtrar duplicados que ya existen en el sheet
  const newEntries = selected.filter(entry => {
    const archiveId = buildArchiveId(entry);
    const textKey = normalizeForDedup(entry);
    return !archiveIds.has(archiveId) && !textKeys.has(textKey);
  });

  if (!DRY_RUN && newEntries.length) {
    await appendRows(sheets, headerMap, newEntries);
  }

  log.info("Archivo X importado al Sheet", {
    rowsWritten: DRY_RUN ? 0 : newEntries.length,
    wouldWrite: DRY_RUN ? newEntries.length : "",
    skippedDuplicate: selected.length - newEntries.length,
    existingRows: archiveIds.size,
    worksheet: WORKSHEET_NAME
  });
}

if (require.main === module) {
  main().catch(err => {
    logger.error("Error importando archivo X", {}, err);
    process.exit(1);
  });
}

module.exports = {
  normalizeForDedup,
  buildArchiveId,
  splitEntries,
  stripEntryNoise
};
