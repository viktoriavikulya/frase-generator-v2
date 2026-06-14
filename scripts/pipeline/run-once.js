require("dotenv").config();

const { logger } = require("../utils/logger");
const {
  getSheetsClient,
  buildHeaderMap,
  getCellValue,
  readRows,
  updateCellsBatch
} = require("../core/sheets");
const { runCarouselPipeline } = require("./run-carousel");
const { runSinglePipeline } = require("./run-single");
const { releaseStaleLocks } = require("../utils/pipeline-utils");
const {
  notifySuccess,
  notifyError,
  notifyNoPending,
  notifyStaleLocks,
  notifyFatal
} = require("../libs/telegram-lib");

function getTipoInput() {
  const raw = (process.env.TIPO_INPUT || "").trim().toLowerCase();

  if (!raw) return "auto";

  if (raw === "single" || raw === "carousel" || raw === "auto") return raw;

  throw new Error(
    `TIPO_INPUT inválido: "${process.env.TIPO_INPUT}". Usa "single", "carousel" o "auto".`
  );
}

/**
 * Lee los errores por plataforma de la primera fila del sheet que tenga
 * estado_general = "error" y coincida con el tipo indicado.
 * Si no encuentra nada, retorna undefined (notifyError omite el bloque).
 *
 * @param {object} opts
 * @param {"single"|"carousel"} opts.tipo
 * @param {string|null} [opts.rowId]       row_id específico (single)
 * @param {string|null} [opts.carouselId]  carousel_id específico (carousel)
 * @returns {Promise<{instagram?:string, facebook?:string, threads?:string}|undefined>}
 */
async function readPlatformErrors({ tipo, rowId = null, carouselId = null }) {
  try {
    const sheets    = await getSheetsClient();
    const rows      = await readRows(sheets);
    const headers   = rows[0];
    const headerMap = buildHeaderMap(headers);

    // Si no hay columnas de error por plataforma en el sheet, salir limpio
    if (!("instagram_error" in headerMap)) return undefined;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];

      // Filtrar por ID si se proporcionó
      if (tipo === "single" && rowId) {
        if (getCellValue(row, headerMap, "row_id") !== rowId) continue;
      }
      if (tipo === "carousel" && carouselId) {
        if (getCellValue(row, headerMap, "carousel_id") !== carouselId) continue;
      }

      // Solo filas que efectivamente fallaron
      const estadoGeneral = getCellValue(row, headerMap, "estado_general");
      if (estadoGeneral !== "error") continue;

      const ig  = getCellValue(row, headerMap, "instagram_error") || "";
      const fb  = getCellValue(row, headerMap, "facebook_error")  || "";
      const th  = getCellValue(row, headerMap, "threads_error")   || "";

      // Si ninguna plataforma tiene error registrado, no vale la pena agregar el bloque
      if (!ig && !fb && !th) return undefined;

      return {
        ...(ig ? { instagram: ig } : {}),
        ...(fb ? { facebook:  fb } : {}),
        ...(th ? { threads:   th } : {})
      };
    }
  } catch (err) {
    // No rompemos el flujo principal si esto falla
    logger.warn("No se pudieron leer los errores de plataforma del sheet", { error: err.message });
  }

  return undefined;
}

async function runSingle({ cycleId, branch }) {
  return runSinglePipeline({ cycleId, branch });
}

async function runCarousel({ cycleId, branch, targetCarouselId }) {
  return runCarouselPipeline({ cycleId, branch, targetCarouselId });
}

async function runAuto({ cycleId, branch, targetCarouselId }) {
  const autoLogger = logger.child({ cycleId, mode: branch, tipo: "auto" });

  autoLogger.info("Modo auto iniciado. Se intentará primero CAROUSEL y luego SINGLE.");

  const carouselResult = await runCarousel({ cycleId, branch, targetCarouselId });

  if (!carouselResult.ok) {
    autoLogger.error("Modo auto detenido por error en CAROUSEL", carouselResult);
    return { ...carouselResult, autoTried: ["carousel"], failedBranch: "carousel" };
  }

  if (carouselResult.processed) {
    autoLogger.info("Modo auto procesó CAROUSEL", carouselResult);
    return { ...carouselResult, autoSelected: "carousel", autoTried: ["carousel"] };
  }

  autoLogger.info("Modo auto no encontró CAROUSEL procesable. Intentando SINGLE.", {
    carouselSkipped: true,
    carouselNoPending: Boolean(carouselResult.noPending)
  });

  const singleResult = await runSingle({ cycleId, branch });

  if (!singleResult.ok) {
    autoLogger.error("Modo auto detenido por error en SINGLE", singleResult);
    return { ...singleResult, autoTried: ["carousel", "single"], failedBranch: "single" };
  }

  if (singleResult.processed) {
    autoLogger.info("Modo auto procesó SINGLE", singleResult);
    return { ...singleResult, autoSelected: "single", autoTried: ["carousel", "single"] };
  }

  return {
    ok: true,
    processed: false,
    noPending: true,
    autoTried: ["carousel", "single"]
  };
}

/**
 * Modo publish-only: saltea render y upload, va directo a publish.
 * Usa TARGET_ROW_NUMBER (single) o TARGET_CAROUSEL_ID (carousel) para apuntar
 * a la fila exacta. El publish-from-sheet ya tiene la lógica de skip si la
 * plataforma ya estaba publicada, así que es idempotente.
 *
 * Nota: runStep usa spawnSync internamente (síncrono), pero se llama con await
 * para que la firma sea compatible con una futura migración a spawn async.
 * Ver comentario en pipeline-utils.js → runStep.
 */
async function runPublishOnly({ cycleId, tipo, publishOnlyId }) {
  const log = logger.child({ cycleId, mode: "publish-only", tipo, publishOnlyId });

  log.info("Modo publish-only iniciado — se omite render y upload");

  const { STATUS, GENERAL_STATUS, LOCK_STATUS } = require("../core/status");
  const { runStep } = require("../utils/pipeline-utils");

  const sheets    = await getSheetsClient();
  const rows      = await readRows(sheets);
  const headers   = rows[0];
  const headerMap = buildHeaderMap(headers);

  let resolvedTipo = tipo;
  let targetRowNumber = null;
  let targetCarouselId = null;

  if (resolvedTipo === "auto" || resolvedTipo === "single") {
    for (let i = 1; i < rows.length; i++) {
      const rowId = getCellValue(rows[i], headerMap, "row_id");
      if (rowId === publishOnlyId) {
        targetRowNumber = i + 1;
        resolvedTipo = "single";
        break;
      }
    }
  }

  if (!targetRowNumber && (resolvedTipo === "auto" || resolvedTipo === "carousel")) {
    for (let i = 1; i < rows.length; i++) {
      const carouselId = getCellValue(rows[i], headerMap, "carousel_id");
      if (carouselId === publishOnlyId) {
        targetCarouselId = publishOnlyId;
        resolvedTipo = "carousel";
        break;
      }
    }
  }

  if (!targetRowNumber && !targetCarouselId) {
    log.error("No se encontró ninguna fila con ese row_id o carousel_id", { publishOnlyId });
    return { ok: false, processed: false, failedStep: "publish-only-not-found" };
  }

  log.info("Fila(s) encontrada(s)", { resolvedTipo, targetRowNumber, targetCarouselId });

  const resetTs = new Date().toISOString();

  if (resolvedTipo === "single" && targetRowNumber) {
    await updateCellsBatch(sheets, [
      { row: targetRowNumber, col: headerMap["estado_publish"]  + 1, value: STATUS.PENDING },
      { row: targetRowNumber, col: headerMap["estado_general"]  + 1, value: GENERAL_STATUS.PENDING },
      { row: targetRowNumber, col: headerMap["lock_status"]     + 1, value: LOCK_STATUS.FREE },
      { row: targetRowNumber, col: headerMap["intentos"]        + 1, value: "0" },
      { row: targetRowNumber, col: headerMap["updated_at"]      + 1, value: resetTs },
      { row: targetRowNumber, col: headerMap["error_step"]      + 1, value: "" },
      { row: targetRowNumber, col: headerMap["error_message"]   + 1, value: "" }
    ]);
  } else if (resolvedTipo === "carousel" && targetCarouselId) {
    const groupRows = [];
    for (let i = 1; i < rows.length; i++) {
      const cid = getCellValue(rows[i], headerMap, "carousel_id");
      if (cid === targetCarouselId) groupRows.push(i + 1);
    }
    await updateCellsBatch(sheets, groupRows.flatMap((rowNum) => [
      { row: rowNum, col: headerMap["estado_publish"]  + 1, value: STATUS.PENDING },
      { row: rowNum, col: headerMap["estado_general"]  + 1, value: GENERAL_STATUS.PENDING },
      { row: rowNum, col: headerMap["lock_status"]     + 1, value: LOCK_STATUS.FREE },
      { row: rowNum, col: headerMap["intentos"]        + 1, value: "0" },
      { row: rowNum, col: headerMap["updated_at"]      + 1, value: resetTs },
      { row: rowNum, col: headerMap["error_step"]      + 1, value: "" },
      { row: rowNum, col: headerMap["error_message"]   + 1, value: "" }
    ]));
  }

  const publishScript = resolvedTipo === "carousel"
    ? "scripts/jobs/carousel/publish-carousel-from-sheet.js"
    : "scripts/jobs/single/publish-single-from-sheet.js";

  const stepContext = {
    cycleId,
    ...(targetRowNumber  ? { targetRowNumber:  String(targetRowNumber) } : {}),
    ...(targetCarouselId ? { targetCarouselId: targetCarouselId        } : {})
  };

  // FIX: await agregado para consistencia con el resto del pipeline y
  // compatibilidad con futura migración de runStep a spawn async.
  const result = await runStep("PUBLISH ONLY", publishScript, stepContext);

  if (!result.ok) {
    log.error("publish-only falló", { publishOnlyId, resolvedTipo });

    const platformErrors = await readPlatformErrors({
      tipo: resolvedTipo,
      rowId:       resolvedTipo === "single"   ? publishOnlyId : null,
      carouselId:  resolvedTipo === "carousel" ? publishOnlyId : null
    });

    return {
      ok: false,
      processed: false,
      failedStep: `${resolvedTipo}-publish-only`,
      tipo: resolvedTipo,
      platformErrors
    };
  }

  if (result.noPending) {
    log.error("publish-only no encontró contenido publicable. La fila existe, pero no cumple condiciones de publish.", {
      publishOnlyId,
      resolvedTipo,
      targetRowNumber,
      targetCarouselId
    });

    return {
      ok: false,
      processed: false,
      failedStep: `${resolvedTipo}-publish-only-no-pending`,
      tipo: resolvedTipo,
      reason: "PUBLISH_ONLY_NO_PENDING"
    };
  }

  log.info("publish-only completado", { publishOnlyId, resolvedTipo });
  return { ok: true, processed: true, tipo: resolvedTipo };
}

async function main() {
  const startMs        = Date.now();
  const cycleId        = `${Date.now()}`;
  const isFormMode     = process.env.FORM_MODE === "true";
  const isPublishOnly  = process.env.PUBLISH_ONLY === "true";
  const publishOnlyId  = (process.env.PUBLISH_ONLY_ID || "").trim();
  const branch         = isFormMode ? "form" : "scheduled";
  const targetCarouselId = process.env.TARGET_CAROUSEL_ID || "";
  const tipo = getTipoInput();

  logger.info("Ejecutando pipeline una sola vez", {
    cycleId,
    mode: isPublishOnly ? "publish-only" : branch,
    tipo,
    targetCarouselId,
    publishOnlyId: publishOnlyId || undefined
  });

  // ── Modo publish-only ──────────────────────────────────────────────────────
  if (isPublishOnly) {
    if (!publishOnlyId) {
      logger.error("PUBLISH_ONLY=true pero PUBLISH_ONLY_ID está vacío");
      process.exit(1);
    }

    let result;
    try {
      result = await runPublishOnly({ cycleId, tipo, publishOnlyId });
    } catch (err) {
      await notifyFatal({ cycleId, errorMessage: err.message || String(err) });
      logger.error("Error fatal en publish-only", {}, err);
      process.exit(1);
    }

    const durationMs = Date.now() - startMs;
    const tipoFinal  = result.tipo || tipo;

    if (!result.ok) {
      await notifyError({
        tipo:           tipoFinal,
        cycleId,
        failedStep:     result.failedStep || "publish-only",
        durationMs,
        platformErrors: result.platformErrors
      });
      process.exit(1);
    }

    await notifySuccess({ tipo: tipoFinal, cycleId, branch: "form", durationMs });
    return;
  }

  // ── Flujo normal ───────────────────────────────────────────────────────────

  const staleReleased = await releaseStaleLocks({ cycleId });
  if (staleReleased > 0) {
    await notifyStaleLocks({ filasLiberadas: staleReleased, cycleId });
  }

  let result;

  if (tipo === "single") {
    result = await runSingle({ cycleId, branch });
  } else if (tipo === "carousel") {
    result = await runCarousel({ cycleId, branch, targetCarouselId });
  } else {
    result = await runAuto({ cycleId, branch, targetCarouselId });
  }

  const durationMs = Date.now() - startMs;
  const tipoFinal  = result.autoSelected || tipo;

  // ── Notificaciones Telegram ──────────────────────────────────────────────
  if (!result.ok) {
    const platformErrors = await readPlatformErrors({
      tipo:       tipoFinal,
      rowId:      result.failedRowId      || null,
      carouselId: result.failedCarouselId || null
    });

    await notifyError({
      tipo:       tipoFinal,
      cycleId,
      failedStep: result.failedStep || result.failedBranch || "desconocido",
      durationMs,
      platformErrors
    });

    logger.error("Pipeline falló", result);
    process.exit(1);
  }

  if (result.processed) {
    await notifySuccess({
      tipo:      tipoFinal,
      cycleId,
      branch,
      recovered: Boolean(result.recoveredPending),
      durationMs
    });
  } else {
    if (!isFormMode) {
      await notifyNoPending({ cycleId, branch });
    }
  }

  logger.info("Pipeline completado", { ok: true, processed: result.processed, cycleId, durationMs });
}

process.on("uncaughtException", async (err) => {
  const cycleId = `${Date.now()}`;
  logger.error("Error fatal no capturado", {}, err);
  try {
    await notifyFatal({ cycleId, errorMessage: err.message || String(err) });
  } catch (_) { /* si telegram también falla, no bloqueamos */ }
  process.exit(1);
});

main().catch(async (err) => {
  const cycleId = `${Date.now()}`;
  logger.error("Error en main de run-once", {}, err);
  try {
    await notifyFatal({ cycleId, errorMessage: err.message || String(err) });
  } catch (_) { /* ignorar */ }
  process.exit(1);
});