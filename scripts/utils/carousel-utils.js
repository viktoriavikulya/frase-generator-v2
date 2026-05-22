const { getCellValue, updateCellsBatch } = require("../core/sheets");
const { nowIsoLocal } = require("../utils/common");
const { STATUS, GENERAL_STATUS, POST_TIPOS, LOCK_STATUS } = require("../core/status");

/**
 * Busca el primer carousel_id elegible según el criterio que pasa cada job,
 * luego retorna todas las filas que pertenecen a ese carrusel ordenadas por carousel_order.
 *
 * @param {Array}    rows      - Todas las filas del sheet (incluyendo header en [0])
 * @param {Object}   headerMap - Mapa de nombre de columna → índice
 * @param {Function} isEligible - (row, headerMap) => boolean — criterio propio de cada etapa
 * @returns {{ selectedCarouselId: string, groupRows: Array }}
 */
function getPendingCarouselRows(rows, headerMap, isEligible) {
  const targetId = process.env.TARGET_CAROUSEL_ID || "";

  let selectedCarouselId = "";

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const postTipo = getCellValue(row, headerMap, "post_tipo").toLowerCase();
    if (postTipo !== POST_TIPOS.CAROUSEL) continue;

    const carouselId = getCellValue(row, headerMap, "carousel_id");
    if (!carouselId) continue;

    if (targetId && carouselId !== targetId) continue;

    if (isEligible(row, headerMap)) {
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

/**
 * Valida que el grupo de filas de un carrusel sea coherente:
 * - Entre 2 y 10 slides
 * - carousel_order enteros >= 1
 * - Sin duplicados en carousel_order
 *
 * @param {Array}  groupRows          - Filas del carrusel ordenadas
 * @param {string} selectedCarouselId - ID del carrusel (para mensajes de error)
 */
function validateCarouselRows(groupRows, selectedCarouselId) {
  if (groupRows.length < 2 || groupRows.length > 10) {
    throw new Error(
      `El carrusel ${selectedCarouselId} tiene ${groupRows.length} slides. Debe tener entre 2 y 10.`
    );
  }

  const orders = groupRows.map((item) => item.order);

  if (orders.some((order) => !Number.isInteger(order) || order < 1)) {
    throw new Error(
      `El carrusel ${selectedCarouselId} tiene carousel_order inválidos. Deben ser enteros mayores o iguales a 1.`
    );
  }

  const uniqueOrders = new Set(orders);

  if (uniqueOrders.size !== orders.length) {
    throw new Error(
      `El carrusel ${selectedCarouselId} tiene carousel_order duplicados.`
    );
  }
}

/**
 * Marca todas las filas de un carrusel como error en el sheet.
 *
 * @param {Object} sheets        - Cliente de Google Sheets
 * @param {Object} headerMap     - Mapa de nombre de columna → índice
 * @param {Array}  groupRows     - Filas del carrusel
 * @param {string} errorStep     - Nombre de la etapa que falló ("carousel-render", "upload", "publish")
 * @param {string} errorMessage  - Mensaje de error
 * @param {string} cycleId       - ID del ciclo actual (para last_cycle_id)
 * @param {number} [attemptsDelta=1] - Cuántos intentos sumar
 */
async function markCarouselGroupAsError(
  sheets,
  headerMap,
  groupRows,
  errorStep,
  errorMessage,
  cycleId,
  attemptsDelta = 1
) {
  const errorTs = nowIsoLocal();
  const updates = [];

  // El estado que se marca como ERROR depende de la etapa que falló.
  // render → estado_render, upload → estado_upload, publish → estado_publish
  const stepToStatusField = {
    "carousel-render": "estado_render",
    "upload": "estado_upload",
    "publish": "estado_publish"
  };

  const statusField = stepToStatusField[errorStep] || "estado_render";

  for (const item of groupRows) {
    const currentAttempts = Number(getCellValue(item.values, headerMap, "intentos") || "0");

    updates.push(
      { row: item.rowNumber, col: headerMap["estado_general"] + 1, value: GENERAL_STATUS.ERROR },
      { row: item.rowNumber, col: headerMap[statusField] + 1, value: STATUS.ERROR },
      { row: item.rowNumber, col: headerMap["lock_status"] + 1, value: LOCK_STATUS.FREE },
      { row: item.rowNumber, col: headerMap["intentos"] + 1, value: String(currentAttempts + attemptsDelta) },
      { row: item.rowNumber, col: headerMap["last_cycle_id"] + 1, value: cycleId },
      { row: item.rowNumber, col: headerMap["updated_at"] + 1, value: errorTs },
      { row: item.rowNumber, col: headerMap["error_step"] + 1, value: errorStep },
      { row: item.rowNumber, col: headerMap["error_message"] + 1, value: errorMessage }
    );
  }

  await updateCellsBatch(sheets, updates);
}

module.exports = {
  getPendingCarouselRows,
  validateCarouselRows,
  markCarouselGroupAsError
};