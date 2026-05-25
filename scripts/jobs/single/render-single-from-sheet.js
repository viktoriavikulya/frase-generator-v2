require("dotenv").config();

const { renderPhrase, stopServer } = require("../../libs/render-lib");
const {
  getSheetsClient,
  buildHeaderMap,
  requireHeaders,
  getCellValue,
  readRows,
  updateCellsBatch
} = require("../../core/sheets");
const { nowIsoLocal } = require("../../utils/common");
const { logger } = require("../../utils/logger");
const {
  STATUS,
  GENERAL_STATUS,
  POST_TIPOS,
  LOCK_STATUS,
  MAX_INTENTOS
} = require("../../core/status");
const { getNextBackgroundColor } = require("../../utils/render-utils");

function findNextSingleRowForRender(rows, headerMap, targetRowNumber) {
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const currentRowNumber = i + 1;

    if (targetRowNumber && currentRowNumber !== targetRowNumber) {
      continue;
    }

    const postTipo    = getCellValue(row, headerMap, "post_tipo").toLowerCase();
    const estadoRender = getCellValue(row, headerMap, "estado_render").toLowerCase();
    const lockStatus  = getCellValue(row, headerMap, "lock_status").toLowerCase();
    const intentos    = Number(getCellValue(row, headerMap, "intentos") || 0);

    const isEligible =
      postTipo === POST_TIPOS.SINGLE &&
      (estadoRender === STATUS.PENDING || estadoRender === STATUS.ERROR) &&
      lockStatus === LOCK_STATUS.FREE &&
      intentos < MAX_INTENTOS;

    if (isEligible) {
      return {
        rowNumber: currentRowNumber,
        values: row
      };
    }
  }

  return null;
}

function getBgForRow(row, rows, headerMap) {
  const existingBg = getCellValue(row, headerMap, "background_color");

  if (existingBg) {
    return existingBg;
  }

  return getNextBackgroundColor(rows, headerMap);
}

async function markRowAsProcessing({
  sheets,
  headerMap,
  rowNumber,
  cycleId
}) {
  const lockTs = nowIsoLocal();

  await updateCellsBatch(sheets, [
    { row: rowNumber, col: headerMap["estado_general"] + 1, value: GENERAL_STATUS.PROCESSING },
    { row: rowNumber, col: headerMap["estado_render"]  + 1, value: STATUS.PROCESSING },
    { row: rowNumber, col: headerMap["lock_status"]    + 1, value: LOCK_STATUS.LOCKED },
    { row: rowNumber, col: headerMap["last_cycle_id"]  + 1, value: cycleId },
    { row: rowNumber, col: headerMap["updated_at"]     + 1, value: lockTs },
    { row: rowNumber, col: headerMap["error_step"]     + 1, value: "" },
    { row: rowNumber, col: headerMap["error_message"]  + 1, value: "" }
  ]);
}

async function markRowAsRendered({
  sheets,
  headerMap,
  rowNumber,
  bg,
  fileName
}) {
  const doneTs = nowIsoLocal();

  await updateCellsBatch(sheets, [
    { row: rowNumber, col: headerMap["background_color"] + 1, value: bg },
    { row: rowNumber, col: headerMap["output_file"]      + 1, value: fileName },
    { row: rowNumber, col: headerMap["fecha_generado"]   + 1, value: doneTs },
    { row: rowNumber, col: headerMap["estado_render"]    + 1, value: STATUS.DONE },

    // Después del render exitoso liberamos la fila para que upload-single pueda tomarla.
    { row: rowNumber, col: headerMap["lock_status"]   + 1, value: LOCK_STATUS.FREE },

    { row: rowNumber, col: headerMap["updated_at"]    + 1, value: doneTs },
    { row: rowNumber, col: headerMap["error_step"]    + 1, value: "" },
    { row: rowNumber, col: headerMap["error_message"] + 1, value: "" }
  ]);
}

async function markRowAsRenderError({
  sheets,
  headerMap,
  rowNumber,
  currentAttempts,
  error
}) {
  const errorTs = nowIsoLocal();

  await updateCellsBatch(sheets, [
    { row: rowNumber, col: headerMap["estado_general"] + 1, value: GENERAL_STATUS.ERROR },
    { row: rowNumber, col: headerMap["estado_render"]  + 1, value: STATUS.ERROR },
    { row: rowNumber, col: headerMap["lock_status"]    + 1, value: LOCK_STATUS.FREE },
    { row: rowNumber, col: headerMap["intentos"]       + 1, value: currentAttempts + 1 },
    { row: rowNumber, col: headerMap["error_step"]     + 1, value: "render" },
    { row: rowNumber, col: headerMap["error_message"]  + 1, value: error.message || String(error) },
    { row: rowNumber, col: headerMap["updated_at"]     + 1, value: errorTs }
  ]);
}

async function main() {
  const cycleId = process.env.PIPELINE_CYCLE_ID || "";

  const targetRowNumber = process.env.TARGET_ROW_NUMBER
    ? Number(process.env.TARGET_ROW_NUMBER)
    : null;

  const log = logger.child({
    job: "render-single",
    cycleId
  });

  const sheets = await getSheetsClient();
  const rows = await readRows(sheets);

  if (rows.length < 2) {
    log.info("No hay datos en la hoja");
    return;
  }

  const headers = rows[0];
  const headerMap = buildHeaderMap(headers);

  const requiredHeaders = [
    "row_id",
    "frase_original",
    "frase_corregida",
    "modo",
    "background_color",
    "estado_general",
    "estado_render",
    "estado_upload",
    "estado_publish",
    "lock_status",
    "intentos",
    "last_cycle_id",
    "error_step",
    "error_message",
    "output_file",
    "fecha_generado",
    "fecha_publicado",
    "post_tipo",
    "updated_at"
  ];

  requireHeaders(headerMap, requiredHeaders);

  const selectedRow = findNextSingleRowForRender(rows, headerMap, targetRowNumber);

  if (!selectedRow) {
    log.info("No hay singles pendientes para render");
    process.exit(10);
  }

  const rowNumber = selectedRow.rowNumber;
  const row       = selectedRow.values;

  const rowId          = getCellValue(row, headerMap, "row_id");
  const fraseOriginal  = getCellValue(row, headerMap, "frase_original");
  const fraseCorregida = getCellValue(row, headerMap, "frase_corregida");
  const mode           = getCellValue(row, headerMap, "modo") || "retro3d";
  const textToRender   = fraseCorregida || fraseOriginal;
  const currentAttempts = Number(getCellValue(row, headerMap, "intentos") || 0);

  const rowLogger = log.child({ rowNumber, rowId, mode });

  const bg = getBgForRow(row, rows, headerMap);

  try {
    if (!textToRender) {
      throw new Error(`La fila ${rowNumber} no tiene frase para renderizar.`);
    }

    rowLogger.info("Fila seleccionada para render", {
      textLength: textToRender.length,
      selectedBg: bg
    });

    await markRowAsProcessing({ sheets, headerMap, rowNumber, cycleId });

    const result = await renderPhrase({ text: textToRender, mode, bg });

    await markRowAsRendered({ sheets, headerMap, rowNumber, bg, fileName: result.fileName });

    rowLogger.info("Fila renderizada correctamente", {
      outputFile: result.fileName,
      bg
    });
  } catch (error) {
    await markRowAsRenderError({ sheets, headerMap, rowNumber, currentAttempts, error });

    rowLogger.error("Error renderizando fila", {}, error);

    throw error;
  }
}

// FIX: usar finally para garantizar que stopServer() siempre se llama,
// incluso si main() resuelve correctamente pero stopServer() lanza.
// El patrón anterior (.then + .catch separados) dejaba stopServer() sin
// try/catch en el camino feliz, lo que producía unhandled rejections.
main()
  .catch((err) => {
    logger.error("Error en render-single-from-sheet", {}, err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await stopServer();
    } catch (stopError) {
      logger.warn("No se pudo cerrar el servidor de render", {}, stopError);
    }
    process.exit(process.exitCode ?? 0);
  });
