const { runStep } = require("./pipeline-utils");
const { logger } = require("./logger");

async function runPipelineSteps({
  label,
  publishFirst = false,
  publishFirstStepName,
  renderStepName,
  renderScript,
  uploadStepName,
  uploadScript,
  publishStepName,
  publishScript,
  noPendingMessage,
  successMessage,
  failedStepPrefix,
  context = {}
}) {
  const pipelineLogger = logger.child({
    pipeline: label,
    ...context
  });

  const startMs = Date.now();
  const isFormMode = context.branch === "form";

  pipelineLogger.info("Pipeline iniciado");

  if (publishFirst) {
    const pendingPublishResult = runStep(
      publishFirstStepName || publishStepName,
      publishScript,
      {
        pipeline: label,
        ...context
      }
    );

    if (!pendingPublishResult.ok && !pendingPublishResult.noPending) {
      pipelineLogger.error("Error publicando pendiente", {
        status: pendingPublishResult.status,
        failedStep: `${failedStepPrefix}-publish-pending`,
        durationMs: Date.now() - startMs
      });

      pipelineLogger.info("Pipeline terminado", {
        processed: false
      });

      return {
        ok: false,
        processed: false,
        failedStep: `${failedStepPrefix}-publish-pending`
      };
    }

    if (pendingPublishResult.ok && !pendingPublishResult.noPending) {
      pipelineLogger.info("Se completó un post pendiente antes de crear uno nuevo.", {
        processed: true,
        durationMs: Date.now() - startMs
      });

      pipelineLogger.info("Pipeline terminado", {
        processed: true
      });

      return {
        ok: true,
        processed: true,
        recoveredPending: true
      };
    }

    if (isFormMode) {
      pipelineLogger.error("FORM_MODE activo: no había publicaciones pendientes. No se renderiza contenido del Sheet.", {
        processed: false,
        durationMs: Date.now() - startMs
      });

      pipelineLogger.info("Pipeline terminado", {
        processed: false
      });

      return {
        ok: false,
        processed: false,
        failedStep: `${failedStepPrefix}-form-no-pending`,
        reason: "FORM_MODE_NO_PENDING"
      };
    }

    pipelineLogger.info("No había publicaciones pendientes; se continúa con render normal.");
  }

  const renderResult = runStep(renderStepName, renderScript, {
    pipeline: label,
    ...context
  });

  if (renderResult.noPending) {
    pipelineLogger.info(noPendingMessage, {
      result: "no_pending",
      durationMs: Date.now() - startMs
    });

    pipelineLogger.info("Pipeline terminado", {
      processed: false
    });

    return {
      ok: true,
      processed: false,
      skipped: true,
      noPending: true
    };
  }

  if (!renderResult.ok) {
    pipelineLogger.error("Error en render", {
      status: renderResult.status,
      failedStep: `${failedStepPrefix}-render`,
      durationMs: Date.now() - startMs
    });

    pipelineLogger.info("Pipeline terminado", {
      processed: false
    });

    return {
      ok: false,
      processed: false,
      failedStep: `${failedStepPrefix}-render`
    };
  }

  const uploadResult = runStep(uploadStepName, uploadScript, {
    pipeline: label,
    ...context
  });

  if (!uploadResult.ok) {
    pipelineLogger.error("Error en upload", {
      status: uploadResult.status,
      failedStep: `${failedStepPrefix}-upload`,
      durationMs: Date.now() - startMs
    });

    pipelineLogger.info("Pipeline terminado", {
      processed: false
    });

    return {
      ok: false,
      processed: false,
      failedStep: `${failedStepPrefix}-upload`
    };
  }

  const publishResult = runStep(publishStepName, publishScript, {
    pipeline: label,
    ...context
  });

  if (!publishResult.ok) {
    pipelineLogger.error("Error en publish", {
      status: publishResult.status,
      failedStep: `${failedStepPrefix}-publish`,
      durationMs: Date.now() - startMs
    });

    pipelineLogger.info("Pipeline terminado", {
      processed: false
    });

    return {
      ok: false,
      processed: false,
      failedStep: `${failedStepPrefix}-publish`
    };
  }

  pipelineLogger.info(successMessage, {
    processed: true,
    durationMs: Date.now() - startMs
  });

  pipelineLogger.info("Pipeline terminado", {
    processed: true
  });

  return {
    ok: true,
    processed: true
  };
}

module.exports = {
  runPipelineSteps
};