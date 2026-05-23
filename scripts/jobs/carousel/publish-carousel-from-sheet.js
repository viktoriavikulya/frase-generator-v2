require("dotenv").config();

const { publishCarouselPost } = require("../../libs/instagram-lib");
const { publishFacebookCarouselPost } = require("../../libs/facebook-lib");
const { publishThreadsCarouselPost } = require("../../libs/threads-lib");
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
const {
  getPendingCarouselRows,
  validateCarouselRows,
  markCarouselGroupAsError
} = require("../../utils/carousel-utils");

const MAX_INTENTOS = 3;

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

    if (!carouselHashtags && rowHashtags) carouselHashtags = rowHashtags;
    if (!mediaUrl) throw new Error(`La fila ${item.rowNumber} no tiene media_url.`);
    if (!carouselCaption && rowCaption) carouselCaption = rowCaption;
    if (!carouselCaption && fallbackCaption) carouselCaption = fallbackCaption;

    imageUrls.push(mediaUrl);
    publicIds.push({ rowNumber: item.rowNumber, publicId: cloudinaryPublicId });
  }

  const finalCaption = [carouselCaption, carouselHashtags].filter(Boolean).join("\n\n");

  return { imageUrls, carouselCaption: finalCaption, publicIds };
}

async function deleteCarouselAssets(publicIds, groupLogger) {
  for (const item of publicIds) {
    if (!item.publicId) continue;
    try {
      await deleteImage(item.publicId);
      groupLogger.info("Asset de Cloudinary eliminado", {
        rowNumber: item.rowNumber,
        cloudinaryPublicId: item.publicId
      });
    } catch (deleteError) {
      groupLogger.warn("No se pudo eliminar el asset de Cloudinary",
        { rowNumber: item.rowNumber, cloudinaryPublicId: item.publicId },
        deleteError
      );
    }
  }
}

async function markCarouselAsPublishing({ sheets, headerMap, groupRows, cycleId }) {
  const lockTs = nowIsoLocal();
  await updateCellsBatch(sheets, groupRows.flatMap((item) => [
    { row: item.rowNumber, col: headerMap["estado_general"] + 1, value: GENERAL_STATUS.PROCESSING },
    { row: item.rowNumber, col: headerMap["estado_publish"] + 1, value: STATUS.PROCESSING },
    { row: item.rowNumber, col: headerMap["lock_status"] + 1, value: LOCK_STATUS.LOCKED },
    { row: item.rowNumber, col: headerMap["last_cycle_id"] + 1, value: cycleId },
    { row: item.rowNumber, col: headerMap["updated_at"] + 1, value: lockTs },
    { row: item.rowNumber, col: headerMap["error_step"] + 1, value: "" },
    { row: item.rowNumber, col: headerMap["error_message"] + 1, value: "" }
  ]));
}

async function markCarouselAsPublished({ sheets, headerMap, groupRows }) {
  const doneTs = nowIsoLocal();
  await updateCellsBatch(sheets, groupRows.flatMap((item) => [
    { row: item.rowNumber, col: headerMap["fecha_publicado"] + 1, value: doneTs },
    { row: item.rowNumber, col: headerMap["estado_publish"] + 1, value: STATUS.DONE },
    { row: item.rowNumber, col: headerMap["estado_general"] + 1, value: GENERAL_STATUS.PUBLISHED },
    { row: item.rowNumber, col: headerMap["lock_status"] + 1, value: LOCK_STATUS.FREE },
    { row: item.rowNumber, col: headerMap["updated_at"] + 1, value: doneTs },
    { row: item.rowNumber, col: headerMap["error_step"] + 1, value: "" },
    { row: item.rowNumber, col: headerMap["error_message"] + 1, value: "" }
  ]));
}

function getFirstExistingValue(groupRows, headerMap, field) {
  return groupRows.reduce((found, item) => {
    if (found) return found;
    return getCellValue(item.values, headerMap, field);
  }, "");
}

async function main() {
  const cycleId = process.env.PIPELINE_CYCLE_ID || "";
  const log = logger.child({ job: "publish-carousel", cycleId });

  const sheets = await getSheetsClient();
  const rows = await readRows(sheets);

  if (rows.length < 2) {
    log.info("No hay datos en la hoja");
    return;
  }

  const headers = rows[0];
  const headerMap = buildHeaderMap(headers);

  const requiredHeaders = [
    "row_id", "updated_at", "post_tipo", "caption", "carousel_id",
    "carousel_order", "carousel_caption", "media_url", "cloudinary_public_id",
    "fecha_publicado", "estado_general", "estado_render", "estado_upload",
    "estado_publish", "lock_status", "intentos", "last_cycle_id",
    "error_step", "error_message", "instagram_creation_id", "instagram_media_id",
    "facebook_photo_id", "facebook_post_id", "hashtags",
    "threads_media_id"
  ];

  requireHeaders(headerMap, requiredHeaders);

  const { selectedCarouselId, groupRows } = getPendingCarouselRows(
    rows,
    headerMap,
    (row, hm) => {
      const estadoRender  = getCellValue(row, hm, "estado_render").toLowerCase();
      const estadoUpload  = getCellValue(row, hm, "estado_upload").toLowerCase();
      const estadoPublish = getCellValue(row, hm, "estado_publish").toLowerCase();
      const lockStatus    = getCellValue(row, hm, "lock_status").toLowerCase();
      const intentos      = Number(getCellValue(row, hm, "intentos") || 0);

      return (
        estadoRender === STATUS.DONE &&
        estadoUpload === STATUS.DONE &&
        (estadoPublish === STATUS.PENDING || estadoPublish === STATUS.ERROR) &&
        (lockStatus === LOCK_STATUS.FREE || lockStatus === LOCK_STATUS.LOCKED) &&
        intentos < MAX_INTENTOS
      );
    }
  );

  if (!selectedCarouselId) {
    log.info("No hay carruseles pendientes para publish");
    process.exit(10);
  }

  validateCarouselRows(groupRows, selectedCarouselId);

  const { imageUrls, carouselCaption, publicIds } = buildCarouselPayload(groupRows, headerMap);

  const groupLogger = log.child({ carouselId: selectedCarouselId, slides: groupRows.length });

  const existingInstagramCreationId = getFirstExistingValue(groupRows, headerMap, "instagram_creation_id");
  const existingInstagramMediaId    = getFirstExistingValue(groupRows, headerMap, "instagram_media_id");
  const existingFacebookPostId      = getFirstExistingValue(groupRows, headerMap, "facebook_post_id");
  const existingThreadsMediaId      = getFirstExistingValue(groupRows, headerMap, "threads_media_id");

  groupLogger.info("Carrusel seleccionado para publish", {
    hasCaption: Boolean(carouselCaption),
    hasExistingInstagram: Boolean(existingInstagramMediaId),
    hasExistingFacebook: Boolean(existingFacebookPostId),
    hasExistingThreads: Boolean(existingThreadsMediaId),
  });

  await markCarouselAsPublishing({ sheets, headerMap, groupRows, cycleId });

  let instagramResult = {
    creationId: existingInstagramCreationId,
    mediaId: existingInstagramMediaId,
    childIds: []
  };

  let facebookResult = {
    postId: existingFacebookPostId,
    mediaFbids: []
  };

  let threadsResult = {
    mediaId: existingThreadsMediaId
  };

  try {
    if (!instagramResult.mediaId) {
      instagramResult = await publishCarouselPost({ imageUrls, caption: carouselCaption });

      await updateCellsBatch(sheets, groupRows.flatMap((item) => [
        { row: item.rowNumber, col: headerMap["instagram_creation_id"] + 1, value: instagramResult.creationId || "" },
        { row: item.rowNumber, col: headerMap["instagram_media_id"] + 1, value: instagramResult.mediaId || "" },
        { row: item.rowNumber, col: headerMap["updated_at"] + 1, value: nowIsoLocal() }
      ]));

      groupLogger.info("Publicado en Instagram", { instagramMediaId: instagramResult.mediaId });
    } else {
      groupLogger.info("Instagram ya estaba publicado; se omite republicación", {
        instagramMediaId: instagramResult.mediaId
      });
    }

    if (!facebookResult.postId) {
      facebookResult = await publishFacebookCarouselPost({ imageUrls, caption: carouselCaption });

      await updateCellsBatch(sheets, groupRows.flatMap((item) => [
        { row: item.rowNumber, col: headerMap["facebook_post_id"] + 1, value: facebookResult.postId || "" },
        {
          row: item.rowNumber,
          col: headerMap["facebook_photo_id"] + 1,
          value: Array.isArray(facebookResult.mediaFbids) ? JSON.stringify(facebookResult.mediaFbids) : ""
        },
        { row: item.rowNumber, col: headerMap["updated_at"] + 1, value: nowIsoLocal() }
      ]));

      groupLogger.info("Publicado en Facebook", { facebookPostId: facebookResult.postId });
    } else {
      groupLogger.info("Facebook ya estaba publicado; se omite republicación", {
        facebookPostId: facebookResult.postId
      });
    }

    if (!threadsResult.mediaId) {
      threadsResult = await publishThreadsCarouselPost({ imageUrls, caption: carouselCaption });

      await updateCellsBatch(sheets, groupRows.flatMap((item) => [
        { row: item.rowNumber, col: headerMap["threads_media_id"] + 1, value: threadsResult.mediaId || "" },
        { row: item.rowNumber, col: headerMap["updated_at"] + 1, value: nowIsoLocal() }
      ]));

      groupLogger.info("Publicado en Threads", { threadsMediaId: threadsResult.mediaId });
    } else {
      groupLogger.info("Threads ya estaba publicado; se omite republicación", {
        threadsMediaId: threadsResult.mediaId
      });
    }

    await markCarouselAsPublished({ sheets, headerMap, groupRows });

    groupLogger.info("Carrusel publicado correctamente", {
      instagramMediaId: instagramResult.mediaId || "",
      facebookPostId: facebookResult.postId || "",
      threadsMediaId: threadsResult.mediaId || "",
    });

    await deleteCarouselAssets(publicIds, groupLogger);
  } catch (error) {
    await markCarouselGroupAsError(
      sheets,
      headerMap,
      groupRows,
      "publish",
      error.message || String(error),
      cycleId
    );

    groupLogger.error("Error publicando carrusel", {}, error);
    throw error;
  }
}

main().catch((err) => {
  logger.error("Error en publish-carousel-from-sheet", {}, err);
  process.exit(1);
});