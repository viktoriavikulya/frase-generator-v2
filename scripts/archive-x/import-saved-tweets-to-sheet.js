require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const { getSheetsAuth } = require("../auth/google-auth");
const { colToLetter, nowIsoLocal } = require("../utils/common");
const { logger } = require("../utils/logger");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_INPUT = path.join(ROOT, "data", "tweets-guardados-x.txt");

const SHEET_ID = process.env.SHEET_ID;
const WORKSHEET_NAME = process.env.SAVED_TWEETS_WORKSHEET_NAME || "archivo_x";
const WORKSHEET_RANGE = "A:L";
const INPUT_PATH = path.resolve(process.env.SAVED_TWEETS_INPUT || DEFAULT_INPUT);
const ONE_PER_LINE = parseBool(process.env.SAVED_TWEETS_ONE_PER_LINE, true);
const DRY_RUN = parseBool(process.env.SAVED_TWEETS_DRY_RUN, false);
const IMPORT_LIMIT = clampNumber(Number(process.env.SAVED_TWEETS_IMPORT_LIMIT || 0), 0, 10000);

/**
 * ESTRUCTURA DE COLUMNAS — Flujo 100% manual
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
  "fuente"
];

async function getSheetsClient() {
  const auth = getSheetsAuth();
  const authClient = await auth.getClient();
  return google.sheets({ version: "v4", auth: authClient });
}

function buildHeaderMap(headers) {
  const map = {};

  headers.forEach((header, index) => {
    const key = String(header || "").trim();
    if (!key) return;
    if (map[key] !== undefined) throw new Error(`Encabezado duplicado: ${key}`);
    map[key] = index;
  });

  return map;
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "si", "s"].includes(String(value).toLowerCase());
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Utilidades de normalización (SIN lógica de scoring)
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

async function getWorksheetProperties(sheets) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: "sheets.properties(sheetId,title,gridProperties.columnCount)"
  });

  return (meta.data.sheets || [])
    .map(sheet => sheet.properties)
    .find(properties => properties?.title === WORKSHEET_NAME);
}

async function readArchiveRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${WORKSHEET_NAME}!${WORKSHEET_RANGE}`
  }).catch(err => {
    if (err.code === 400 || err.code === 404) return { data: { values: [] } };
    throw err;
  });

  return res.data.values || [];
}

/**
 * Columnas legacy que NO pertenecen al contrato archivo_x.
 * Si la hoja ya existía con ellas, se emite un warning claro.
 * El importador nunca las crea ni las escribe.
 */
const LEGACY_COLUMNS = [
  "sirve",
  "estado",
  "prioridad",
  "accion",
  "recomendacion_auto",
  "calidad",
  "riesgo",
  "subtema",
  "clasificado_manual",
  "fila_txt"
];

async function ensureArchiveContract(sheets, rows) {
  const currentHeaders = (rows[0] || []).map(header => String(header || "").trim());
  const isCleanContract =
    currentHeaders.length === HEADERS.length &&
    HEADERS.every((header, index) => currentHeaders[index] === header);

  if (isCleanContract) {
    return rows;
  }

  const legacyFound = currentHeaders.filter(header => LEGACY_COLUMNS.includes(header));
  if (legacyFound.length) {
    logger.warn(
      `archivo_x contiene columnas legacy: ${legacyFound.join(", ")}. ` +
      "Se normalizara la pestana para preservar solo las 12 columnas validas."
    );
  }

  const currentMap = buildHeaderMap(currentHeaders);
  const cleanRows = [
    HEADERS,
    ...rows.slice(1).map(row => HEADERS.map(header => {
      const index = currentMap[header];
      return index === undefined ? "" : row?.[index] ?? "";
    }))
  ];

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${WORKSHEET_NAME}!${WORKSHEET_RANGE}`
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${WORKSHEET_NAME}!A1:${colToLetter(HEADERS.length)}${cleanRows.length}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: cleanRows
    }
  });

  const properties = await getWorksheetProperties(sheets);
  const columnCount = properties?.gridProperties?.columnCount || 0;
  if (properties?.sheetId !== undefined && columnCount > HEADERS.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: properties.sheetId,
                dimension: "COLUMNS",
                startIndex: HEADERS.length,
                endIndex: columnCount
              }
            }
          }
        ]
      }
    });
  }

  return cleanRows;
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

  set("id", archiveId);
  set("frase_original", originalText);
  set("frase_final", "");
  set("decision_editorial", "pendiente");
  set("grupo_carrusel", "");
  set("notas", "");
  set("temporalidad", "atemporal");
  set("temporada", "");
  set("capturado_en", capturedAt);
  set("actualizado_en", "");
  set("lote_importacion", importBatch);
  set("fuente", "tweets-guardados-x");

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

  entries.forEach((entry) => {
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
  rows = await ensureArchiveContract(sheets, rows);

  const headerMap = buildHeaderMap(rows[0]);
  const { archiveIds, textKeys } = buildExistingIndexes(rows, headerMap);

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
  main,
  normalizeForDedup,
  buildArchiveId,
  splitEntries,
  stripEntryNoise
};
