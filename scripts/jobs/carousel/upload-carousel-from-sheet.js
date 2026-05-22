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
  LOCK_STATUS
} = require("../../core/status");

const MAX_INTENTOS = 3;
const OUTPUT_DIR = path.resolve(__dirname, "..", "..", "..", "output");

function getPendingCarouselRows(rows, headerMap) {
  let selectedCarouselId = "";

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const postTipo = getCellValue(row, headerMap, "post_tipo").toLowerCase();
    const estadoRender = getCellValue(row, headerMap, "estado_render").toLowerCase();
    const estadoUpload = getCellValue(row, headerMap, "estado_upload").toLowerCase();
    const lockStatus = getCellValue(row, headerMap, "lock_status").toLowerCase();
    const carouselId = getCellValue(row, headerMap, "carousel_id");
    const intentos = Number(getCellValue(row, headerMap, "intentos") || 0);

    const isEligible =
      postTipo === POST_TIPOS.CAROUSEL &&
      estadoRender === STATUS.DONE &&
      (estadoUpload === STATUS.PENDING || estadoUpload === STATUS.ERROR) &&
      (lockStatus === LOCK_STATUS.FREE || lockStatus === LOCK_STATUS.LOCKED) &&
      carouselId &&
      intentos < MAX_INTENTOS;

    if (isEligible) {
      const targetId = process.env.TARGET_CAROUSEL_ID || "";
      if (targetId && carouselId !== targetId) continue;
      selectedCarouselId = carouselId;
      break;
    }
  }

  if (!selectedCarouselId) {
    return { selectedCarouselId: "", groupRows: [] };
  }

  const groupRows = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const postTipo = getCellValue(row, headerMap, "post_tipo").toLowerCase();
    const carouselId = getCellValue(row, headerMap, "carousel_id");

    if (postTipo === POST_TIPOS.CAROUSEL && carouselId === selectedCarouselId) {
      groupRows.push({
        rowNumber: i + 1,
        values: row,
        order: Number(getCellValue(row, headerMap, "carousel_order") || "0")
      });
    }
  }

  groupRows.sort((a, b) => a.order - b.order);

  return { selectedCarouselId, groupRows };
}

function validateCarouselRows(groupRows, selectedCarouselId) {
  if (groupRows.length < 2 || groupRows.length > 10) {
    throw new Error(
      `El carrusel ${selectedCarouselId} tiene ${groupRows.length} slides. Debe tener entre 2 y 10.`
    );
  }

  const orders = groupRows.map((item) => item.order);

  if (orders.some((order) => !Number.isInteger(order) || order < 1)) {
    throw new Error(
      `El carrusel ${selectedCarouselId} tiene carousel_order inválidos.`
    );
  }

  const uniqueOrders = new Set(orders);

  if (uniqueOrders.size !== orders.length) {
    throw new Error(
      `El carrusel ${selectedCarouselId} tiene carousel_order duplicados.`
    );
  }
}

async function markGroupAsError(sheets, headerMap, groupRows, errorMessage, attemptsDelta = 1) {
  const errorTs = nowIsoLocal();
  const updates = [];

  for (const item of groupRows) {
    const currentAttempts = Number(getCellValue(item.values, headerMap, "intentos") || "0");

    updates.push(
      { row: item.rowNumber, col: headerMap["estado_general"] + 1, value: GENERAL_STATUS.ERROR },
      { row: item.rowNumber, col: headerMap["estado_upload"] + 1, value: STATUS.ERROR },
      { row: item.rowNumber, col: headerMap["lock_status"] + 1, value: LOCK_STATUS.FREE },
      { row: item.rowNumber, col: headerMap["intentos"] + 1, value: currentAttempts + attemptsDelta },
      { row: item.rowNumber, col: headerMap["error_step"] + 1, value: "upload" },
      { row: item.rowNumber, col: headerMap["error_message"] + 1, value: errorMessage },
      { row: item.rowNumber, col: headerMap["updated_at"] + 1, value: errorTs }
    );
  }

  await updateCellsBatch(sheets, updates);
}

async function main() {
  const cycleId = process.env.PIPELINE_CYCLE_ID || "";
  const log = logger.child({
    job: "upload-carousel",
    cycleId
  });

  const sheets = await getSheetsClient();
  const rows = await readRows(sheets);

  if (rows.length < 2) {
    log.info("No hay datos");
    return;
  }

  const headers = rows[0];
  const headerMap = buildHeaderMap(headers);

  const requiredHeaders = [
    "row_id",
    "updated_at",
    "post_tipo",
    "carousel_id",
    "carousel_order",
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

  const { selectedCarouselId, groupRows } = getPendingCarouselRows(rows, headerMap);

  if (!selectedCarouselId) {
    log.info("No hay carruseles pendientes para upload");
    process.exit(10);
  }

  validateCarouselRows(groupRows, selectedCarouselId);

  const groupLogger = log.child({
    carouselId: selectedCarouselId,
    slides: groupRows.length
  });

  groupLogger.info("Carrusel seleccionado para upload");

  // Capturamos el timestamp una sola vez para el batch de lock
  const lockTs = nowIsoLocal();
  const prepUpdates = [];

  for (const item of groupRows) {
    const estadoUploadOriginal = getCellValue(item.values, headerMap, "estado_upload").toLowerCase();

    prepUpdates.push(
      { row: item.rowNumber, col: headerMap["estado_general"] + 1, value: GENERAL_STATUS.PROCESSING },
      { row: item.rowNumber, col: headerMap["lock_status"] + 1, value: LOCK_STATUS.LOCKED },
      { row: item.rowNumber, col: headerMap["last_cycle_id"] + 1, value: cycleId },
      { row: item.rowNumber, col: headerMap["updated_at"] + 1, value: lockTs },
      { row: item.rowNumber, col: headerMap["error_step"] + 1, value: "" },
      { row: item.rowNumber, col: headerMap["error_message"] + 1, value: "" }
    );

    if (estadoUploadOriginal === STATUS.PENDING || estadoUploadOriginal === STATUS.ERROR) {
      prepUpdates.push({
        row: item.rowNumber,
        col: headerMap["estado_upload"] + 1,
        value: STATUS.PROCESSING
      });
    }
  }

  await updateCellsBatch(sheets, prepUpdates);

  try {
    for (const item of groupRows) {
      const rowNumber = item.rowNumber;
      const row = item.values;

      const rowId = getCellValue(row, headerMap, "row_id");
      const fileName = getCellValue(row, headerMap, "output_file");
      const estadoUploadOriginal = getCellValue(row, headerMap, "estado_upload").toLowerCase();

      if (estadoUploadOriginal !== STATUS.PENDING && estadoUploadOriginal !== STATUS.ERROR) {
        groupLogger.info("Slide ya subido, saltando", {
          rowNumber,
          estadoUpload: estadoUploadOriginal
        });
        continue;
      }

      const rowLogger = groupLogger.child({
        rowNumber,
        rowId,
        order: item.order
      });

      if (!fileName) {
        throw new Error(`Fila ${rowNumber} no tiene archivo renderizado.`);
      }

      const localPath = path.join(OUTPUT_DIR, fileName);

      if (!fs.existsSync(localPath)) {
        throw new Error(
          `No existe el archivo local para la fila ${rowNumber}: ${localPath}`
        );
      }

      rowLogger.info("Subiendo slide", { outputFile: fileName, localPath });

      const result = await uploadImage(localPath, fileName);

      if (fs.existsSync(localPath)) {
        try {
          fs.unlinkSync(localPath);
          rowLogger.info("Archivo local eliminado", { localPath });
        } catch (deleteErr) {
          rowLogger.warn("No se pudo eliminar el archivo local", { localPath }, deleteErr);
        }
      }

      // Capturamos el timestamp una sola vez para el batch de éxito de este slide
      const doneTs = nowIsoLocal();

      await updateCellsBatch(sheets, [
        { row: rowNumber, col: headerMap["media_url"] + 1, value: result.secureUrl },
        { row: rowNumber, col: headerMap["cloudinary_public_id"] + 1, value: result.publicId },
        { row: rowNumber, col: headerMap["fecha_upload"] + 1, value: doneTs },
        { row: rowNumber, col: headerMap["estado_upload"] + 1, value: STATUS.DONE },
        { row: rowNumber, col: headerMap["updated_at"] + 1, value: doneTs },
        { row: rowNumber, col: headerMap["error_step"] + 1, value: "" },
        { row: rowNumber, col: headerMap["error_message"] + 1, value: "" }
      ]);

      rowLogger.info("Slide subido correctamente", {
        mediaUrl: result.secureUrl,
        publicId: result.publicId
      });
    }

    groupLogger.info("Carrusel subido completo");
  } catch (err) {
    await markGroupAsError(
      sheets,
      headerMap,
      groupRows,
      err.message || String(err)
    );

    groupLogger.error("Error subiendo carrusel", {}, err);
    throw err;
  }
}

main().catch((err) => {
  logger.error("Error en upload-carousel-from-sheet", {}, err);
  process.exit(1);
});