require("dotenv").config();

const { renderPhrase } = require("../../libs/render-lib");
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
  MAX_INTENTOS,
  BG_SEQUENCE
} = require("../../core/status");
const {
  getPendingCarouselRows,
  validateCarouselRows,
  markCarouselGroupAsError
} = require("../../utils/carousel-utils");

function getLastPublishedBg(rows, headerMap) {
  let latestBg = "";
  let latestTime = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const estadoGeneral = getCellValue(row, headerMap, "estado_general").toLowerCase();
    const bg = getCellValue(row, headerMap, "background_color");
    const fechaPublicado = getCellValue(row, headerMap, "fecha_publicado");
    const postTipo = getCellValue(row, headerMap, "post_tipo").toLowerCase();

    if (
      estadoGeneral !== GENERAL_STATUS.PUBLISHED ||
      !["single", "carousel"].includes(postTipo) ||
      !bg ||
      !fechaPublicado
    ) {
      continue;
    }

    const timestamp = Date.parse(fechaPublicado);
    if (Number.isNaN(timestamp)) continue;

    if (timestamp > latestTime) {
      latestTime = timestamp;
      latestBg = bg.toLowerCase();
    }
  }

  return latestBg;
}

function getNextColor(color) {
  if (!color) return BG_SEQUENCE[0];

  const index = BG_SEQUENCE.findIndex(
    (item) => item.toLowerCase() === color.toLowerCase()
  );

  if (index === -1) return BG_SEQUENCE[0];

  return BG_SEQUENCE[(index + 1) % BG_SEQUENCE.length];
}

function hasCarouselAwaitingPublish(rows, headerMap) {
  const seenCarousels = new Map();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const postTipo = getCellValue(row, headerMap, "post_tipo").toLowerCase();
    if (postTipo !== POST_TIPOS.CAROUSEL) continue;

    const carouselId = getCellValue(row, headerMap, "carousel_id");
    if (!carouselId) continue;

    const estadoUpload = getCellValue(row, headerMap, "estado_upload").toLowerCase();
    const estadoPublish = getCellValue(row, headerMap, "estado_publish").toLowerCase();

    if (!seenCarousels.has(carouselId)) {
      seenCarousels.set(carouselId, { hasUploadDone: false, hasPublishPending: false });
    }

    const entry = seenCarousels.get(carouselId);
    if (estadoUpload === STATUS.DONE) entry.hasUploadDone = true;
    if (estadoPublish === STATUS.PENDING || estadoPublish === STATUS.ERROR) entry.hasPublishPending = true;
  }

  for (const [, entry] of seenCarousels) {
    if (entry.hasUploadDone && entry.hasPublishPending) return true;
  }

  return false;
}

async function main() {
  const cycleId = process.env.PIPELINE_CYCLE_ID || "";
  const log = logger.child({
    job: "render-carousel",
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
    "carousel_id",
    "carousel_order"
  ];

  requireHeaders(headerMap, requiredHeaders);

  if (hasCarouselAwaitingPublish(rows, headerMap)) {
    log.info("Hay un carrusel con upload completo pendiente de publicar. No se inicia nuevo render.", {
      blocked: true
    });
    process.exit(10);
  }

  const { selectedCarouselId, groupRows } = getPendingCarouselRows(
    rows,
    headerMap,
    (row, hm) => {
      const estadoRender = getCellValue(row, hm, "estado_render").toLowerCase();
      const lockStatus   = getCellValue(row, hm, "lock_status").toLowerCase();
      const intentos     = Number(getCellValue(row, hm, "intentos") || 0);

      return (
        (estadoRender === STATUS.PENDING || estadoRender === STATUS.ERROR) &&
        lockStatus === LOCK_STATUS.FREE &&
        intentos < MAX_INTENTOS
      );
    }
  );

  if (!selectedCarouselId) {
    log.info("No hay carruseles pendientes para render");
    process.exit(10);
  }

  validateCarouselRows(groupRows, selectedCarouselId);

  const groupLogger = log.child({
    carouselId: selectedCarouselId,
    slides: groupRows.length
  });

  groupLogger.info("Carrusel seleccionado para render");

  const lastPublishedBg = getLastPublishedBg(rows, headerMap);
  const carouselBg = getNextColor(lastPublishedBg);

  const lockTs = nowIsoLocal();
  const lockUpdates = [];

  for (const item of groupRows) {
    lockUpdates.push(
      { row: item.rowNumber, col: headerMap["estado_general"] + 1, value: GENERAL_STATUS.PROCESSING },
      { row: item.rowNumber, col: headerMap["estado_render"] + 1, value: STATUS.PROCESSING },
      { row: item.rowNumber, col: headerMap["lock_status"] + 1, value: LOCK_STATUS.LOCKED },
      { row: item.rowNumber, col: headerMap["last_cycle_id"] + 1, value: cycleId },
      { row: item.rowNumber, col: headerMap["updated_at"] + 1, value: lockTs },
      { row: item.rowNumber, col: headerMap["error_step"] + 1, value: "" },
      { row: item.rowNumber, col: headerMap["error_message"] + 1, value: "" }
    );
  }

  await updateCellsBatch(sheets, lockUpdates);

  try {
    for (const item of groupRows) {
      const rowNumber = item.rowNumber;
      const row = item.values;

      const rowId = getCellValue(row, headerMap, "row_id");
      const fraseOriginal = getCellValue(row, headerMap, "frase_original");
      const fraseCorregida = getCellValue(row, headerMap, "frase_corregida");
      const mode = getCellValue(row, headerMap, "modo") || "retro3d";
      const textToRender = fraseCorregida || fraseOriginal;
      const estadoRenderOriginal = getCellValue(row, headerMap, "estado_render").toLowerCase();

      if (estadoRenderOriginal !== STATUS.PENDING && estadoRenderOriginal !== STATUS.ERROR) {
        groupLogger.info("Slide ya renderizado, saltando", {
          rowNumber,
          estadoRender: estadoRenderOriginal
        });
        continue;
      }

      if (!textToRender) {
        throw new Error(`La fila ${rowNumber} no tiene frase para renderizar.`);
      }

      const rowLogger = groupLogger.child({
        rowNumber,
        rowId,
        order: item.order,
        mode
      });

      rowLogger.info("Renderizando slide", {
        textLength: textToRender.length,
        backgroundColor: carouselBg
      });

      const result = await renderPhrase({ text: textToRender, mode, bg: carouselBg });

      const doneTs = nowIsoLocal();

      await updateCellsBatch(sheets, [
        { row: rowNumber, col: headerMap["background_color"] + 1, value: carouselBg },
        { row: rowNumber, col: headerMap["output_file"] + 1, value: result.fileName },
        { row: rowNumber, col: headerMap["fecha_generado"] + 1, value: doneTs },
        { row: rowNumber, col: headerMap["estado_render"] + 1, value: STATUS.DONE },
        { row: rowNumber, col: headerMap["updated_at"] + 1, value: doneTs },
        { row: rowNumber, col: headerMap["error_step"] + 1, value: "" },
        { row: rowNumber, col: headerMap["error_message"] + 1, value: "" }
      ]);

      rowLogger.info("Slide renderizado correctamente", { outputFile: result.fileName });
    }

    groupLogger.info("Carrusel renderizado completo", { backgroundColor: carouselBg });
  } catch (error) {
    await markCarouselGroupAsError(
      sheets,
      headerMap,
      groupRows,
      "carousel-render",
      error.message || String(error),
      cycleId
    );

    groupLogger.error("Error renderizando carrusel", {}, error);
    throw error;
  }
}

main().catch((err) => {
  logger.error("Error en render-carousel-from-sheet", {}, err);
  process.exit(1);
});