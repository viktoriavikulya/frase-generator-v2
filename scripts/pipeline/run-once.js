require("dotenv").config();

const { logger } = require("../utils/logger");
const { runCarouselPipeline } = require("./run-carousel");

async function main() {
  const cycleId = `${Date.now()}`;
  const isFormMode = process.env.FORM_MODE === "true";

  logger.info("Ejecutando pipeline una sola vez", { 
    cycleId,
    mode: isFormMode ? "form" : "scheduled"
  });

  const result = await runCarouselPipeline({
    cycleId,
    branch: isFormMode ? "form" : "scheduled"
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