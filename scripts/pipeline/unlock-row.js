require("dotenv").config();

/**
 * unlock-row.js
 *
 * Desbloquea manualmente una fila o carrusel atascado en lock_status=locked
 * sin esperar los 10 minutos del release automático de stale locks.
 *
 * Variables de entorno:
 *   UNLOCK_ID  — row_id (single) o carousel_id (carousel) a desbloquear
 *
 * Resultado:
 *   - lock_status     → free
 *   - estado_general  → error   (para que el próximo ciclo lo reintente)
 *   - el estado del paso atascado (render/upload/publish) → error
 *   - error_message   → mensaje explicativo
 *   - intentos        → no se toca (el pipeline decide si reintenta o no)
 */

const {
  getSheetsClient,
  buildHeaderMap,
  getCellValue,
  readRows,
  updateCellsBatch
} = require("../core/sheets");

const { logger }                        = require("../utils/logger");
const { STATUS, GENERAL_STATUS, LOCK_STATUS } = require("../core/status");
const { nowIsoLocal }                   = require("../utils/common");
const { sendMessage }                   = require("../libs/telegram-lib");

async function main() {
  const unlockId = (process.env.UNLOCK_ID || "").trim();

  if (!unlockId) {
    logger.error("UNLOCK_ID está vacío. Pasá el row_id o carousel_id a desbloquear.");
    process.exit(1);
  }

  const log = logger.child({ job: "unlock-row", unlockId });

  log.info("Iniciando desbloqueo manual", { unlockId });

  const sheets    = await getSheetsClient();
  const rows      = await readRows(sheets);
  const headerMap = buildHeaderMap(rows[0]);

  const needed = [
    "lock_status", "estado_general", "estado_render",
    "estado_upload", "estado_publish", "error_step",
    "error_message", "updated_at"
  ];

  for (const col of needed) {
    if (!(col in headerMap)) {
      logger.error(`Columna requerida no encontrada en el sheet: ${col}`);
      process.exit(1);
    }
  }

  // Buscar filas que coincidan con el UNLOCK_ID (por row_id o carousel_id)
  const targetRows = [];

  for (let i = 1; i < rows.length; i++) {
    const row        = rows[i];
    const rowId      = getCellValue(row, headerMap, "row_id");
    const carouselId = "carousel_id" in headerMap
      ? getCellValue(row, headerMap, "carousel_id")
      : "";

    if (rowId === unlockId || carouselId === unlockId) {
      targetRows.push({ rowNumber: i + 1, row });
    }
  }

  if (targetRows.length === 0) {
    logger.error("No se encontró ninguna fila con ese row_id o carousel_id", { unlockId });
    process.exit(1);
  }

  const errorTs  = nowIsoLocal();
  const errorMsg = `Desbloqueado manualmente (UNLOCK_ID=${unlockId})`;
  const updates  = [];

  for (const { rowNumber, row } of targetRows) {
    const estadoRender  = getCellValue(row, headerMap, "estado_render").toLowerCase();
    const estadoUpload  = getCellValue(row, headerMap, "estado_upload").toLowerCase();
    const estadoPublish = getCellValue(row, headerMap, "estado_publish").toLowerCase();

    // Detectar en qué paso estaba atascada
    let staleStep = "unknown";
    if (estadoPublish === STATUS.PROCESSING)     staleStep = "publish";
    else if (estadoUpload === STATUS.PROCESSING) staleStep = "upload";
    else if (estadoRender === STATUS.PROCESSING) staleStep = "render";

    log.warn("Desbloqueando fila", { rowNumber, staleStep });

    updates.push(
      { row: rowNumber, col: headerMap["lock_status"]    + 1, value: LOCK_STATUS.FREE },
      { row: rowNumber, col: headerMap["estado_general"] + 1, value: GENERAL_STATUS.ERROR },
      { row: rowNumber, col: headerMap["error_step"]     + 1, value: staleStep },
      { row: rowNumber, col: headerMap["error_message"]  + 1, value: errorMsg },
      { row: rowNumber, col: headerMap["updated_at"]     + 1, value: errorTs }
    );

    // Revertir el paso atascado a error para que sea reintentable
    if (staleStep === "render") {
      updates.push({ row: rowNumber, col: headerMap["estado_render"]  + 1, value: STATUS.ERROR });
    } else if (staleStep === "upload") {
      updates.push({ row: rowNumber, col: headerMap["estado_upload"]  + 1, value: STATUS.ERROR });
    } else if (staleStep === "publish") {
      updates.push({ row: rowNumber, col: headerMap["estado_publish"] + 1, value: STATUS.ERROR });
    }
  }

  await updateCellsBatch(sheets, updates);

  const filasDesbloqueadas = targetRows.length;
  log.info("Desbloqueo completado", { filasDesbloqueadas, unlockId });

  await sendMessage(
    `🔓 <b>Desbloqueo manual</b>\n` +
    `ID: <code>${unlockId}</code>\n` +
    `${filasDesbloqueadas} fila${filasDesbloqueadas > 1 ? "s" : ""} liberada${filasDesbloqueadas > 1 ? "s" : ""}.\n` +
    `El próximo ciclo las reintentará automáticamente.`
  );
}

main().catch(err => {
  logger.error("Error en unlock-row", {}, err);
  process.exit(1);
});