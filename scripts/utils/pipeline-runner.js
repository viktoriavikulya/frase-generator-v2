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

  // En scheduled mode: intentar primero publicar cualquier post que quedó
  // render+upload done pero sin publicar (recuperación de ciclos anteriores).
  // En form mode este bloque se salta — va directo a render → upload → publish.
  if (publishFirst) {
    const pendingPublishResult = await runStep(
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

      pipelineLogger.info("Pipeline terminado", { processed: false });

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

      pipelineLogger.info("Pipeline terminado", { processed: true });

      return {
        ok: true,
        processed: true,
        recoveredPending: true
      };
    }

    pipelineLogger.info("No había publicaciones pendientes; se continúa con render normal.");
  }

  const renderResult = await runStep(renderStepName, renderScript, {
    pipeline: label,
    ...context
  });

  // En form mode el render debe encontrar exactamente la fila/carrusel que
  // acaba de registrarse. Si no hay nada pendiente algo salió mal (race condition,
  // fila ya procesada, etc.) — fallamos explícitamente en lugar de continuar.
  if (renderResult.noPending && isFormMode) {
    pipelineLogger.error("FORM_MODE activo: no se encontró contenido pendiente para renderizar.", {
      processed: false,
      durationMs: Date.now() - startMs
    });

    pipelineLogger.info("Pipeline terminado", { processed: false });

    return {
      ok: false,
      processed: false,
      failedStep: `${failedStepPrefix}-form-no-pending`,
      reason: "FORM_MODE_NO_PENDING"
    };
  }

  if (renderResult.noPending) {
    pipelineLogger.info(noPendingMessage, {
      result: "no_pending",
      durationMs: Date.now() - startMs
    });

    pipelineLogger.info("Pipeline terminado", { processed: false });

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

    pipelineLogger.info("Pipeline terminado", { processed: false });

    return {
      ok: false,
      processed: false,
      failedStep: `${failedStepPrefix}-render`
    };
  }

  const uploadResult = await runStep(uploadStepName, uploadScript, {
    pipeline: label,
    ...context
  });

  if (!uploadResult.ok) {
    pipelineLogger.error("Error en upload", {
      status: uploadResult.status,
      failedStep: `${failedStepPrefix}-upload`,
      durationMs: Date.now() - startMs
    });

    pipelineLogger.info("Pipeline terminado", { processed: false });

    return {
      ok: false,
      processed: false,
      failedStep: `${failedStepPrefix}-upload`
    };
  }

  const publishResult = await runStep(publishStepName, publishScript, {
    pipeline: label,
    ...context
  });

  if (!publishResult.ok) {
    pipelineLogger.error("Error en publish", {
      status: publishResult.status,
      failedStep: `${failedStepPrefix}-publish`,
      durationMs: Date.now() - startMs
    });

    pipelineLogger.info("Pipeline terminado", { processed: false });

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

  pipelineLogger.info("Pipeline terminado", { processed: true });

  return {
    ok: true,
    processed: true
  };
}

module.exports = {
  runPipelineSteps
};