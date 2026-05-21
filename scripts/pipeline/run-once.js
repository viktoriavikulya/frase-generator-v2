require("dotenv").config();

const { logger } = require("../utils/logger");
const { runCarouselPipeline } = require("./run-carousel");
const { runSinglePipeline } = require("./run-single");

async function main() {
  const cycleId = `${Date.now()}`;
  const isFormMode = process.env.FORM_MODE === "true";
  const targetCarouselId = process.env.TARGET_CAROUSEL_ID || "";
  const tipo = process.env.TIPO_INPUT === "single" ? "single" : "carousel";

  logger.info("Ejecutando pipeline una sola vez", {
    cycleId,
    mode: isFormMode ? "form" : "scheduled",
    tipo,
    targetCarouselId
  });

  const result = tipo === "single"
    ? await runSinglePipeline({
        cycleId,
        branch: isFormMode ? "form" : "scheduled"
      })
    : await runCarouselPipeline({
        cycleId,
        branch: isFormMode ? "form" : "scheduled",
        targetCarouselId
      });

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