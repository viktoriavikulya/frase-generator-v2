require("dotenv").config();

const { logger } = require("../utils/logger");
const { runCarouselPipeline } = require("./run-carousel");
const { runSinglePipeline } = require("./run-single");

function getTipoInput() {
  const raw = (process.env.TIPO_INPUT || "").trim().toLowerCase();

  if (!raw) {
    return "auto";
  }

  if (raw === "single" || raw === "carousel" || raw === "auto") {
    return raw;
  }

  throw new Error(
    `TIPO_INPUT inválido: "${process.env.TIPO_INPUT}". Usa "single", "carousel" o "auto".`
  );
}

async function runSingle({ cycleId, branch }) {
  return runSinglePipeline({
    cycleId,
    branch
  });
}

async function runCarousel({ cycleId, branch, targetCarouselId }) {
  return runCarouselPipeline({
    cycleId,
    branch,
    targetCarouselId
  });
}

async function runAuto({ cycleId, branch, targetCarouselId }) {
  const autoLogger = logger.child({
    cycleId,
    mode: branch,
    tipo: "auto"
  });

  autoLogger.info("Modo auto iniciado. Se intentará primero SINGLE y luego CAROUSEL.");

  const singleResult = await runSingle({
    cycleId,
    branch
  });

  if (!singleResult.ok) {
    autoLogger.error("Modo auto detenido por error en SINGLE", singleResult);

    return {
      ...singleResult,
      autoTried: ["single"],
      failedBranch: "single"
    };
  }

  if (singleResult.processed) {
    autoLogger.info("Modo auto procesó SINGLE", singleResult);

    return {
      ...singleResult,
      autoSelected: "single",
      autoTried: ["single"]
    };
  }

  autoLogger.info("Modo auto no encontró SINGLE procesable. Intentando CAROUSEL.", {
    singleSkipped: true,
    singleNoPending: Boolean(singleResult.noPending)
  });

  const carouselResult = await runCarousel({
    cycleId,
    branch,
    targetCarouselId
  });

  if (!carouselResult.ok) {
    autoLogger.error("Modo auto detenido por error en CAROUSEL", carouselResult);

    return {
      ...carouselResult,
      autoTried: ["single", "carousel"],
      failedBranch: "carousel"
    };
  }

  if (carouselResult.processed) {
    autoLogger.info("Modo auto procesó CAROUSEL", carouselResult);

    return {
      ...carouselResult,
      autoSelected: "carousel",
      autoTried: ["single", "carousel"]
    };
  }

  autoLogger.info("Modo auto no encontró contenido procesable.", {
    singleNoPending: Boolean(singleResult.noPending),
    carouselNoPending: Boolean(carouselResult.noPending)
  });

  return {
    ok: true,
    processed: false,
    skipped: true,
    noPending: true,
    autoSelected: "",
    autoTried: ["single", "carousel"]
  };
}

async function main() {
  const cycleId = `${Date.now()}`;
  const isFormMode = process.env.FORM_MODE === "true";
  const branch = isFormMode ? "form" : "scheduled";
  const targetCarouselId = process.env.TARGET_CAROUSEL_ID || "";
  const tipo = getTipoInput();

  logger.info("Ejecutando pipeline una sola vez", {
    cycleId,
    mode: branch,
    tipo,
    targetCarouselId
  });

  let result;

  if (tipo === "single") {
    result = await runSingle({
      cycleId,
      branch
    });
  } else if (tipo === "carousel") {
    result = await runCarousel({
      cycleId,
      branch,
      targetCarouselId
    });
  } else {
    result = await runAuto({
      cycleId,
      branch,
      targetCarouselId
    });
  }

  if (!result.ok) {
    logger.error("Pipeline falló", result);
    process.exit(1);
  }

  logger.info("Pipeline completado", result);
  process.exit(0);
}

main().catch((error) => {
  logger.error("Error fatal", {}, error);
  process.exit(1);
});