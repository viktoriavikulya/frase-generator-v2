const { runPipelineSteps } = require("../utils/pipeline-runner");

function runCarouselPipeline(context = {}) {
  const isFormMode = context.branch === "form";

  return runPipelineSteps({
    label: "CAROUSEL",

    // En formulario NO intentamos publish pending
    publishFirst: !isFormMode,
    publishFirstStepName: "PUBLISH PENDING CAROUSEL",

    renderStepName: "RENDER CAROUSEL",
    renderScript: "scripts/jobs/carousel/render-carousel-from-sheet.js",

    uploadStepName: "UPLOAD CAROUSEL",
    uploadScript: "scripts/jobs/carousel/upload-carousel-from-sheet.js",

    publishStepName: "PUBLISH CAROUSEL",
    publishScript: "scripts/jobs/carousel/publish-carousel-from-sheet.js",

    noPendingMessage: "No quedan carruseles pendientes.",
    successMessage: "Se procesó 1 carrusel completo en este ciclo.",
    failedStepPrefix: "carousel",
    context
  });
}

module.exports = { runCarouselPipeline };