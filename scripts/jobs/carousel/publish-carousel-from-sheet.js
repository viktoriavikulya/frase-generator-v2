require("dotenv").config();

const { publishCarouselPost } = require("../../libs/instagram-lib");
const { publishFacebookCarouselPost } = require("../../libs/facebook-lib");
const { deleteImage } = require("../../libs/upload-lib");
const {
  getSheetsClient,
  buildHeaderMap,
  requireHeaders,
  getCellValue,
  readRows,
  updateCellsBatch
} = require("../../core/sheets");
const { nowIsoLocal } = require("../../utils/common");
const { logger } = require("../../utils/logger");
const {
  STATUS,
  GENERAL_STATUS,
  POST_TIPOS,
  LOCK_STATUS
} = require("../../core/status");

function getPendingCarouselRows(rows, headerMap) {
  let selectedCarouselId = "";

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const postTipo = getCellValue(row, headerMap, "post_tipo").toLowerCase();
    const estadoRender = getCellValue(row, headerMap, "estado_render").toLowerCase();
    const estadoUpload = getCellValue(row, headerMap, "estado_upload").toLowerCase();
    const estadoPublish = getCellValue(row, headerMap, "estado_publish").toLowerCase();
    const lockStatus = getCellValue(row, headerMap, "lock_status").toLowerCase();
    const carouselId = getCellValue(row, headerMap, "carousel_id");

    const isEligible =
      postTipo === POST_TIPOS.CAROUSEL &&
      estadoRender === STATUS.DONE &&
      estadoUpload === STATUS.DONE &&
      (estadoPublish === STATUS.PENDING || estadoPublish === STATUS.ERROR) &&
      (lockStatus === LOCK_STATUS.FREE || lockStatus === LOCK_STATUS.LOCKED) &&
      carouselId;

    if (isEligible) {
      const targetId = process.env.TARGET_CAROUSEL_ID || "";
      if (targetId && carouselId !== targetId) continue;
      selectedCarouselId = carouselId;
      break;
    }
  }

  if (!selectedCarouselId) {
    return { selectedCarouselId: "", groupRows: [] };
  }

  const groupRows = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const postTipo = getCellValue(row, headerMap, "post_tipo").toLowerCase();
    const carouselId = getCellValue(row, headerMap, "carousel_id");

    const belongsToSelected =
      postTipo === POST_TIPOS.CAROUSEL &&
      carouselId === selectedCarouselId;

    if (belongsToSelected) {
      groupRows.push({
        rowNumber: i + 1,
        values: row,
        order: Number(getCellValue(row, headerMap, "carousel_order") || "0")
      });
    }
  }

  groupRows.sort((a, b) => a.order - b.order);

  return { selectedCarouselId, groupRows };
}

function validateCarouselRows(groupRows, selectedCarouselId) {
  if (groupRows.length < 2 || groupRows.length > 10) {
    throw new Error(
      `El carrusel ${selectedCarouselId} tiene ${groupRows.length} slides. Debe tener entre 2 y 10.`
    );
  }

  const orders = groupRows.map((item) => item.order);

  if (orders.some((order) => !Number.isInteger(order) || order < 1)) {
    throw new Error(
      `El carrusel ${selectedCarouselId} tiene carousel_order inválidos. Deben ser enteros >= 1.`
    );
  }

  const uniqueOrders = new Set(orders);

  if (uniqueOrders.size !== orders.length) {
    throw new Error(
      `El carrusel ${selectedCarouselId} tiene carousel_order duplicados.`
    );
  }
}

function buildCarouselPayload(groupRows, headerMap) {
  const imageUrls = [];
  const publicIds = [];
  let carouselCaption = "";
  let carouselHashtags = "";

  for (const item of groupRows) {
    const row = item.values;

    const mediaUrl = getCellValue(row, headerMap, "media_url");
    const rowCaption = getCellValue(row, headerMap, "carousel_caption");
    const fallbackCaption = getCellValue(row, headerMap, "caption");
    const cloudinaryPublicId = getCellValue(row, headerMap, "cloudinary_public_id");
    const rowHashtags = getCellValue(row, headerMap, "hashtags");

    if (!carouselHashtags && rowHashtags) {
      carouselHashtags = rowHashtags;
    }

    if (!mediaUrl) {
      throw new Error(`La fila ${item.rowNumber} no tiene media_url.`);
    }

    if (!carouselCaption && rowCaption) {
      carouselCaption = rowCaption;
    }

    if (!carouselCaption && fallbackCaption) {
      carouselCaption = fallbackCaption;
    }

    imageUrls.push(mediaUrl);
    publicIds.push({
      rowNumber: item.rowNumber,
      publicId: cloudinaryPublicId
    });
  }

    const finalCaption = [carouselCaption, carouselHashtags]
      .filter(Boolean)
      .join("\n\n");

  return { imageUrls, carouselCaption: finalCaption, publicIds };
}

async function deleteCarouselAssets(publicIds, groupLogger) {
  for (const item of publicIds) {
    if (!item.publicId) {
      continue;
    }

    try {
      await deleteImage(item.publicId);
      groupLogger.info("Asset de Cloudinary eliminado", {
        rowNumber: item.rowNumber,
        cloudinaryPublicId: item.publicId
      });
    } catch (deleteError) {
      groupLogger.warn(
        "No se pudo eliminar el asset de Cloudinary",
        {
          rowNumber: item.rowNumber,
          cloudinaryPublicId: item.publicId
        },
        deleteError
      );
    }
  }
}

async function markGroupAsError(sheets, headerMap, groupRows, errorMessage, attemptsDelta = 1) {
  const now = nowIsoLocal();
  const updates = [];

  for (const item of groupRows) {
    const currentAttempts = Number(getCellValue(item.values, headerMap, "intentos") || "0");

    updates.push(
      {
        row: item.rowNumber,
        col: headerMap["estado_general"] + 1,
        value: GENERAL_STATUS.ERROR
      },
      {
        row: item.rowNumber,
        col: headerMap["estado_publish"] + 1,
        value: STATUS.ERROR
      },
      {
        row: item.rowNumber,
        col: headerMap["lock_status"] + 1,
        value: LOCK_STATUS.FREE
      },
      {
        row: item.rowNumber,
        col: headerMap["intentos"] + 1,
        value: currentAttempts + attemptsDelta
      },
      {
        row: item.rowNumber,
        col: headerMap["error_step"] + 1,
        value: "publish"
      },
      {
        row: item.rowNumber,
        col: headerMap["error_message"] + 1,
        value: errorMessage
      },
      {
        row: item.rowNumber,
        col: headerMap["updated_at"] + 1,
        value: now
      }
    );
  }

  await updateCellsBatch(sheets, updates);
}

async function main() {
  const cycleId = process.env.PIPELINE_CYCLE_ID || "";
  const log = logger.child({
    job: "publish-carousel",
    cycleId
  });

  const sheets = await getSheetsClient();
  const rows = await readRows(sheets);

  if (rows.length < 2) {
    log.info("No hay datos en la hoja");
    return;
  }

  const headers = rows[0];
  const headerMap = buildHeaderMap(headers);

  const requiredHeaders = [
    "row_id",
    "updated_at",
    "post_tipo",
    "caption",
    "carousel_id",
    "carousel_order",
    "carousel_caption",
    "media_url",
    "cloudinary_public_id",
    "fecha_publicado",
    "estado_general",
    "estado_render",
    "estado_upload",
    "estado_publish",
    "lock_status",
    "intentos",
    "last_cycle_id",
    "error_step",
    "error_message",
    "instagram_creation_id",
    "instagram_media_id",
    "facebook_photo_id",
    "facebook_post_id",
    "hashtags"
  ];

  requireHeaders(headerMap, requiredHeaders);

  const { selectedCarouselId, groupRows } = getPendingCarouselRows(rows, headerMap);

  if (!selectedCarouselId) {
    log.info("No hay carruseles pendientes para publish");
    process.exit(10);
  }

  validateCarouselRows(groupRows, selectedCarouselId);

  const { imageUrls, carouselCaption, publicIds } = buildCarouselPayload(
    groupRows,
    headerMap
  );

  const groupLogger = log.child({
    carouselId: selectedCarouselId,
    slides: groupRows.length
  });

  groupLogger.info("Carrusel seleccionado para publish", {
    hasCaption: Boolean(carouselCaption)
  });

  await updateCellsBatch(
    sheets,
    groupRows.flatMap((item) => [
      {
        row: item.rowNumber,
        col: headerMap["estado_publish"] + 1,
        value: STATUS.PROCESSING
      },
      {
        row: item.rowNumber,
        col: headerMap["last_cycle_id"] + 1,
        value: cycleId
      },
      {
        row: item.rowNumber,
        col: headerMap["updated_at"] + 1,
        value: nowIsoLocal()
      },
      {
        row: item.rowNumber,
        col: headerMap["error_step"] + 1,
        value: ""
      },
      {
        row: item.rowNumber,
        col: headerMap["error_message"] + 1,
        value: ""
      }
    ])
  );

  // Idempotencia: leemos los IDs existentes de todas las filas del grupo,
  // no solo de la primera, para no perder resultados parciales previos.
  const existingInstagramMediaId = groupRows.reduce((found, item) => {
    if (found) return found;
    return getCellValue(item.values, headerMap, "instagram_media_id");
  }, "");

  const existingInstagramCreationId = groupRows.reduce((found, item) => {
    if (found) return found;
    return getCellValue(item.values, headerMap, "instagram_creation_id");
  }, "");

  const existingFacebookPostId = groupRows.reduce((found, item) => {
    if (found) return found;
    return getCellValue(item.values, headerMap, "facebook_post_id");
  }, "");

  let instagramResult = {
    creationId: existingInstagramCreationId,
    mediaId: existingInstagramMediaId,
    childIds: []
  };

  let facebookResult = {
    postId: existingFacebookPostId,
    mediaFbids: []
  };

  try {
    if (!instagramResult.mediaId) {
      instagramResult = await publishCarouselPost({
        imageUrls,
        caption: carouselCaption
      });
    }

    if (!facebookResult.postId) {
      facebookResult = await publishFacebookCarouselPost({
        imageUrls,
        caption: carouselCaption
      });
    }

    const now = nowIsoLocal();

    await updateCellsBatch(
      sheets,
      groupRows.flatMap((item) => [
        {
          row: item.rowNumber,
          col: headerMap["instagram_creation_id"] + 1,
          value: instagramResult.creationId || ""
        },
        {
          row: item.rowNumber,
          col: headerMap["instagram_media_id"] + 1,
          value: instagramResult.mediaId || ""
        },
        {
          row: item.rowNumber,
          col: headerMap["facebook_post_id"] + 1,
          value: facebookResult.postId || ""
        },
        {
          row: item.rowNumber,
          col: headerMap["facebook_photo_id"] + 1,
          value: Array.isArray(facebookResult.mediaFbids)
            ? JSON.stringify(facebookResult.mediaFbids)
            : ""
        },
        {
          row: item.rowNumber,
          col: headerMap["fecha_publicado"] + 1,
          value: now
        },
        {
          row: item.rowNumber,
          col: headerMap["estado_publish"] + 1,
          value: STATUS.DONE
        },
        {
          row: item.rowNumber,
          col: headerMap["estado_general"] + 1,
          value: GENERAL_STATUS.PUBLISHED
        },
        {
          row: item.rowNumber,
          col: headerMap["lock_status"] + 1,
          value: LOCK_STATUS.FREE
        },
        {
          row: item.rowNumber,
          col: headerMap["updated_at"] + 1,
          value: now
        },
        {
          row: item.rowNumber,
          col: headerMap["error_step"] + 1,
          value: ""
        },
        {
          row: item.rowNumber,
          col: headerMap["error_message"] + 1,
          value: ""
        }
      ])
    );

    groupLogger.info("Carrusel publicado correctamente", {
      instagramMediaId: instagramResult.mediaId || "",
      instagramCreationId: instagramResult.creationId || "",
      facebookPostId: facebookResult.postId || ""
    });

    await deleteCarouselAssets(publicIds, groupLogger);
  } catch (error) {
    await markGroupAsError(
      sheets,
      headerMap,
      groupRows,
      error.message || String(error)
    );

    groupLogger.error("Error publicando carrusel", {}, error);
    throw error;
  }
}

main().catch((err) => {
  logger.error("Error en publish-carousel-from-sheet", {}, err);
  process.exit(1);
});