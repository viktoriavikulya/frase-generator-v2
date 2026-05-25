const { spawnSync } = require("child_process");
const path = require("path");
const { logger } = require("./logger");
const {
  getSheetsClient,
  buildHeaderMap,
  readRows,
  getCellValue,
  updateCellsBatch
} = require("../core/sheets");
const { STATUS, GENERAL_STATUS, LOCK_STATUS } = require("../core/status");
const { nowIsoLocal } = require("./common");

const PROJECT_ROOT = path.join(__dirname, "..", "..");

// Timeout máximo por paso en milisegundos.
// Render es el más lento (Playwright + descarga de fuentes): 4 min es generoso.
// Si un paso supera esto, algo está colgado y es mejor fallar rápido.
const STEP_TIMEOUT_MS = 4 * 60 * 1000; // 4 minutos

// Una fila lleva más de este tiempo en estado "processing" + lock "locked"
// sin actualizarse → el proceso que la tomó fue killed. Se libera para reintento.
// Debe ser mayor que STEP_TIMEOUT_MS para no liberar pasos que aún están corriendo.
const STALE_LOCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutos

function now() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateWaitMs(waitMs) {
  if (!Number.isFinite(waitMs) || waitMs <= 0) {
    throw new Error("WAIT_MS debe ser un número positivo.");
  }
}

function buildStepEnv(context = {}) {
  return {
    ...process.env,
    PIPELINE_CYCLE_ID:   context.cycleId          || process.env.PIPELINE_CYCLE_ID   || "",
    PIPELINE_SLOT_KEY:   context.slotKey           || process.env.PIPELINE_SLOT_KEY   || "",
    PIPELINE_BRANCH:     context.branch            || process.env.PIPELINE_BRANCH     || "",
    TARGET_CAROUSEL_ID:  context.targetCarouselId  || process.env.TARGET_CAROUSEL_ID  || "",
    TARGET_ROW_NUMBER:   context.targetRowNumber   || process.env.TARGET_ROW_NUMBER   || ""
  };
}

/**
 * Ejecuta un script hijo de forma SÍNCRONA (spawnSync) y devuelve su resultado.
 *
 * IMPORTANTE: esta función es intencionalmente síncrona para garantizar que los
 * pasos del pipeline se ejecuten en orden estricto (render → upload → publish).
 * Si se migra a spawn() async en el futuro, pipeline-runner.js ya tiene los
 * `await` en cada llamada — pero también habrá que revisar toda la lógica de
 * manejo de resultados para asegurarse de que sigue siendo secuencial.
 *
 * Códigos de salida reconocidos:
 *   0  → éxito
 *   10 → sin pendientes (noPending = true)
 *   cualquier otro → error
 */
function runStep(stepName, scriptPath, context = {}) {
  const stepLogger = logger.child({
    ...context,
    step: stepName
  });

  stepLogger.info("Iniciando paso", { script: scriptPath });

  const result = spawnSync(process.execPath, [scriptPath], {
    stdio:   "inherit",
    cwd:     PROJECT_ROOT,
    env:     buildStepEnv(context),
    timeout: STEP_TIMEOUT_MS
  });

  // spawnSync pone error.code === 'ETIMEDOUT' cuando se cumple el timeout
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      stepLogger.error("El paso superó el tiempo máximo y fue cancelado", {
        timeoutMs: STEP_TIMEOUT_MS
      });
    } else {
      stepLogger.error("Error ejecutando paso", {}, result.error);
    }

    return { ok: false, status: 1, failed: true, noPending: false };
  }

  if (result.signal) {
    stepLogger.error("El paso terminó por señal", { signal: result.signal });
    return { ok: false, status: 1, failed: true, noPending: false };
  }

  const status = typeof result.status === "number" ? result.status : 1;

  if (status === 0) {
    stepLogger.info("Paso completado correctamente", { status });
    return { ok: true, status, failed: false, noPending: false };
  }

  if (status === 10) {
    stepLogger.info("Paso sin pendientes", { status });
    return { ok: true, status, failed: false, noPending: true };
  }

  stepLogger.warn("Paso terminó con código no exitoso", { status });
  return { ok: false, status, failed: true, noPending: false };
}

/**
 * Libera filas que quedaron bloqueadas porque un proceso fue killed (timeout,
 * cancelación de GitHub Actions, SIGKILL) sin ejecutar su bloque catch.
 *
 * Una fila está "stale" cuando:
 *   - lock_status = "locked"  (el proceso la tomó)
 *   - estado_general = "processing"  (nunca terminó)
 *   - updated_at lleva más de STALE_LOCK_THRESHOLD_MS sin cambiar
 *
 * La liberamos marcándola como ERROR con un mensaje explicativo, para que el
 * próximo ciclo la reintente normalmente (si intentos < MAX_INTENTOS).
 *
 * @param {Object} options
 * @param {string} options.cycleId  - ID del ciclo actual (para last_cycle_id)
 */
async function releaseStaleLocks({ cycleId } = {}) {
  const cleanupLogger = logger.child({ job: "release-stale-locks", cycleId });

  let sheets;
  let rows;

  try {
    sheets = await getSheetsClient();
    rows = await readRows(sheets);
  } catch (err) {
    // Si no podemos leer la hoja, no bloqueamos el pipeline — solo avisamos.
    cleanupLogger.warn("No se pudo leer la hoja para cleanup de locks", {}, err);
    return;
  }

  if (rows.length < 2) return;

  const headers = rows[0];

  // Columnas mínimas necesarias para el cleanup.
  // Si alguna no existe simplemente salimos sin tocar nada.
  const needed = [
    "lock_status", "estado_general", "updated_at",
    "estado_render", "estado_upload", "estado_publish",
    "error_step", "error_message", "last_cycle_id", "intentos"
  ];

  let headerMap;
  try {
    headerMap = buildHeaderMap(headers);
    for (const col of needed) {
      if (!(col in headerMap)) {
        cleanupLogger.warn(`Columna "${col}" no encontrada; se omite cleanup`);
        return;
      }
    }
  } catch (err) {
    cleanupLogger.warn("Error construyendo headerMap en cleanup", {}, err);
    return;
  }

  const nowMs = Date.now();
  const updates = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1;

    const lockStatus   = getCellValue(row, headerMap, "lock_status").toLowerCase();
    const estadoGeneral = getCellValue(row, headerMap, "estado_general").toLowerCase();

    // Solo nos interesan filas activamente bloqueadas en processing
    if (lockStatus !== LOCK_STATUS.LOCKED) continue;
    if (estadoGeneral !== GENERAL_STATUS.PROCESSING) continue;

    const updatedAt = getCellValue(row, headerMap, "updated_at");
    const updatedAtMs = updatedAt ? Date.parse(updatedAt) : NaN;

    // Si no podemos parsear la fecha, o la fila es reciente, la dejamos
    if (isNaN(updatedAtMs)) continue;
    if (nowMs - updatedAtMs < STALE_LOCK_THRESHOLD_MS) continue;

    // Detectar en qué paso se quedó colgada para marcar el estado correcto
    const estadoRender  = getCellValue(row, headerMap, "estado_render").toLowerCase();
    const estadoUpload  = getCellValue(row, headerMap, "estado_upload").toLowerCase();
    const estadoPublish = getCellValue(row, headerMap, "estado_publish").toLowerCase();
    const intentos      = Number(getCellValue(row, headerMap, "intentos") || 0);

    let staleStep = "unknown";
    if (estadoPublish === STATUS.PROCESSING) staleStep = "publish";
    else if (estadoUpload === STATUS.PROCESSING) staleStep = "upload";
    else if (estadoRender === STATUS.PROCESSING) staleStep = "render";

    const errorMsg = `Lock liberado automáticamente: proceso killed en paso "${staleStep}" (inactivo por más de ${STALE_LOCK_THRESHOLD_MS / 60000} min)`;
    const errorTs  = nowIsoLocal();

    cleanupLogger.warn("Fila con lock stale detectada", {
      rowNumber,
      staleStep,
      updatedAt,
      minutosAtascada: Math.round((nowMs - updatedAtMs) / 60000)
    });

    // Revertir el estado del paso atascado a ERROR para que sea reintentable,
    // y liberar el lock. No tocamos los pasos que ya están en DONE.
    updates.push(
      { row: rowNumber, col: headerMap["estado_general"] + 1, value: GENERAL_STATUS.ERROR },
      { row: rowNumber, col: headerMap["lock_status"]    + 1, value: LOCK_STATUS.FREE },
      { row: rowNumber, col: headerMap["intentos"]       + 1, value: intentos + 1 },
      { row: rowNumber, col: headerMap["error_step"]     + 1, value: staleStep },
      { row: rowNumber, col: headerMap["error_message"]  + 1, value: errorMsg },
      { row: rowNumber, col: headerMap["last_cycle_id"]  + 1, value: cycleId || "" },
      { row: rowNumber, col: headerMap["updated_at"]     + 1, value: errorTs }
    );

    // Revertir solo el paso atascado a ERROR (los pasos previos que ya son DONE se respetan)
    if (staleStep === "render") {
      updates.push({ row: rowNumber, col: headerMap["estado_render"] + 1, value: STATUS.ERROR });
    } else if (staleStep === "upload") {
      updates.push({ row: rowNumber, col: headerMap["estado_upload"] + 1, value: STATUS.ERROR });
    } else if (staleStep === "publish") {
      updates.push({ row: rowNumber, col: headerMap["estado_publish"] + 1, value: STATUS.ERROR });
    }
  }

  if (updates.length === 0) {
    cleanupLogger.info("No hay locks stale. Todo limpio.");
    return 0;
  }

  try {
    await updateCellsBatch(sheets, updates);
    const filasLiberadas = updates.filter(u => u.value === LOCK_STATUS.FREE).length;
    cleanupLogger.info("Locks stale liberados", { filasLiberadas });
    return filasLiberadas;
  } catch (err) {
    // Error al escribir: avisamos pero no bloqueamos el pipeline
    cleanupLogger.warn("No se pudieron liberar locks stale", {}, err);
    return 0;
  }
}

module.exports = {
  now,
  sleep,
  validateWaitMs,
  runStep,
  releaseStaleLocks,
  PROJECT_ROOT,
};