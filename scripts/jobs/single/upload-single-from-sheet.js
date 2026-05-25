const fs = require("fs");
require("dotenv").config();

const path = require("path");
const { uploadImage } = require("../../libs/upload-lib");
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

const OUTPUT_DIR = path.resolve(__dirname, "..", "..", "..", "output");

function findNextUploadRow(rows, headerMap, targetRowNumber) {
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const currentRowNumber = i + 1;

    if (targetRowNumber && currentRowNumber !== targetRowNumber) continue;

    const postTipo = getCellValue(row, headerMap, "post_tipo").toLowerCase();
    const estadoRender = getCellValue(row, headerMap, "estado_render").toLowerCase();
    const estadoUpload = getCellValue(row, headerMap, "estado_upload").toLowerCase();
    const lockStatus = getCellValue(row, headerMap, "lock_status").toLowerCase();
    const intentos = Number(getCellValue(row, headerMap, "intentos") || 0);

    const isEligible =
      postTipo === POST_TIPOS.SINGLE &&
      estadoRender === STATUS.DONE &&
      (estadoUpload === STATUS.PENDING || estadoUpload === STATUS.ERROR) &&
      lockStatus === LOCK_STATUS.FREE &&   // FIX: solo FREE es elegible; LOCKED significa que otro ciclo la está procesando
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

async function main() {
  const cycleId = process.env.PIPELINE_CYCLE_ID || "";
  const targetRowNumber = process.env.TARGET_ROW_NUMBER
    ? Number(process.env.TARGET_ROW_NUMBER)
    : null;

  const log = logger.child({
    job: "upload-single",
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
    "updated_at",
    "post_tipo",
    "estado_general",
    "estado_render",
    "estado_upload",
    "lock_status",
    "intentos",
    "last_cycle_id",
    "error_step",
    "error_message",
    "output_file",
    "media_url",
    "cloudinary_public_id",
    "fecha_upload"
  ];

  requireHeaders(headerMap, requiredHeaders);

  const targetRow = findNextUploadRow(rows, headerMap, targetRowNumber);

  if (!targetRow) {
    log.info("No hay singles pendientes para upload");
    process.exit(10);
  }

  const rowNumber = targetRow.rowNumber;
  const row = targetRow.values;

  const rowId = getCellValue(row, headerMap, "row_id");
  const outputFile = getCellValue(row, headerMap, "output_file");
  const currentAttempts = Number(getCellValue(row, headerMap, "intentos") || 0);

  const rowLogger = log.child({
    rowNumber,
    rowId,
    outputFile
  });

  if (!outputFile) {
    throw new Error(`La fila ${rowNumber} no tiene output_file.`);
  }

  const localPath = path.join(OUTPUT_DIR, outputFile);

  if (!fs.existsSync(localPath)) {
    const resetTs = nowIsoLocal();

    await updateCellsBatch(sheets, [
      { row: rowNumber, col: headerMap["estado_general"] + 1, value: GENERAL_STATUS.ERROR },
      { row: rowNumber, col: headerMap["estado_render"] + 1, value: STATUS.ERROR },
      { row: rowNumber, col: headerMap["estado_upload"] + 1, value: STATUS.PENDING },
      { row: rowNumber, col: headerMap["lock_status"] + 1, value: LOCK_STATUS.FREE },
      { row: rowNumber, col: headerMap["error_step"] + 1, value: "render" },
      { row: rowNumber, col: headerMap["error_message"] + 1, value: `Archivo renderizado no disponible en este runner: ${localPath}` },
      { row: rowNumber, col: headerMap["updated_at"] + 1, value: resetTs }
    ]);

    rowLogger.warn("Archivo local no existe; la fila queda lista para re-render", { localPath });
    process.exit(10);
  }

  rowLogger.info("Fila seleccionada para upload", { localPath });

  const lockTs = nowIsoLocal();

  await updateCellsBatch(sheets, [
    { row: rowNumber, col: headerMap["estado_general"] + 1, value: GENERAL_STATUS.PROCESSING },
    { row: rowNumber, col: headerMap["estado_upload"] + 1, value: STATUS.PROCESSING },
    { row: rowNumber, col: headerMap["lock_status"] + 1, value: LOCK_STATUS.LOCKED },
    { row: rowNumber, col: headerMap["last_cycle_id"] + 1, value: cycleId },
    { row: rowNumber, col: headerMap["updated_at"] + 1, value: lockTs },
    { row: rowNumber, col: headerMap["error_step"] + 1, value: "" },
    { row: rowNumber, col: headerMap["error_message"] + 1, value: "" }
  ]);

  try {
    const uploadResult = await uploadImage(localPath, outputFile);

    if (fs.existsSync(localPath)) {
      try {
        fs.unlinkSync(localPath);
        rowLogger.info("Archivo local eliminado", { localPath });
      } catch (deleteErr) {
        rowLogger.warn("No se pudo eliminar el archivo local", { localPath }, deleteErr);
      }
    }

    const doneTs = nowIsoLocal();

    await updateCellsBatch(sheets, [
      { row: rowNumber, col: headerMap["media_url"] + 1, value: uploadResult.secureUrl },
      { row: rowNumber, col: headerMap["cloudinary_public_id"] + 1, value: uploadResult.publicId },
      { row: rowNumber, col: headerMap["fecha_upload"] + 1, value: doneTs },
      { row: rowNumber, col: headerMap["estado_upload"] + 1, value: STATUS.DONE },
      { row: rowNumber, col: headerMap["lock_status"] + 1, value: LOCK_STATUS.FREE },
      { row: rowNumber, col: headerMap["updated_at"] + 1, value: doneTs },
      { row: rowNumber, col: headerMap["error_step"] + 1, value: "" },
      { row: rowNumber, col: headerMap["error_message"] + 1, value: "" }
    ]);

    rowLogger.info("Fila subida correctamente", {
      mediaUrl: uploadResult.secureUrl,
      publicId: uploadResult.publicId
    });
  } catch (error) {
    const errorTs = nowIsoLocal();

    await updateCellsBatch(sheets, [
      { row: rowNumber, col: headerMap["estado_general"] + 1, value: GENERAL_STATUS.ERROR },
      { row: rowNumber, col: headerMap["estado_upload"] + 1, value: STATUS.ERROR },
      { row: rowNumber, col: headerMap["lock_status"] + 1, value: LOCK_STATUS.FREE },
      { row: rowNumber, col: headerMap["intentos"] + 1, value: currentAttempts + 1 },
      { row: rowNumber, col: headerMap["error_step"] + 1, value: "upload" },
      { row: rowNumber, col: headerMap["error_message"] + 1, value: error.message || String(error) },
      { row: rowNumber, col: headerMap["updated_at"] + 1, value: errorTs }
    ]);

    rowLogger.error("Error subiendo fila", {}, error);
    throw error;
  }
}

main().catch((err) => {
  logger.error("Error en upload-single-from-sheet", {}, err);
  process.exit(1);
});
