const { runPipelineSteps } = require("../utils/pipeline-runner");

function runSinglePipeline(context = {}) {
  const isFormMode = context.branch === "form";

  return runPipelineSteps({
    label: "SINGLE",

    publishFirst: !isFormMode,  // en form mode va directo a render → upload → publish
    publishFirstStepName: "PUBLISH PENDING SINGLE",

    renderStepName: "RENDER SINGLE",
    renderScript: "scripts/jobs/single/render-single-from-sheet.js",

    uploadStepName: "UPLOAD SINGLE",
    uploadScript: "scripts/jobs/single/upload-single-from-sheet.js",

    publishStepName: "PUBLISH SINGLE",
    publishScript: "scripts/jobs/single/publish-single-from-sheet.js",

    noPendingMessage: "No quedan posts single pendientes.",
    successMessage: "Se procesó 1 post single en este ciclo.",
    failedStepPrefix: "single",
    context
  });
}

module.exports = {
  runSinglePipeline
};