const { spawnSync } = require("child_process");
const path = require("path");
const { logger } = require("./logger");

const PROJECT_ROOT = path.join(__dirname, "..", "..");

// Timeout máximo por paso en milisegundos.
// Render es el más lento (Playwright + descarga de fuentes): 4 min es generoso.
// Si un paso supera esto, algo está colgado y es mejor fallar rápido.
const STEP_TIMEOUT_MS = 4 * 60 * 1000; // 4 minutos

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
    TARGET_CAROUSEL_ID:  context.targetCarouselId  || process.env.TARGET_CAROUSEL_ID  || ""
  };
}

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
    timeout: STEP_TIMEOUT_MS        // ← nuevo: mata el proceso si supera 4 minutos
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

module.exports = {
  now,
  sleep,
  validateWaitMs,
  runStep,
  PROJECT_ROOT
};