require("dotenv").config();

const { publishImagePost } = require("../../libs/instagram-lib");
const { publishFacebookImagePost } = require("../../libs/facebook-lib");
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
  LOCK_STATUS,
  MAX_INTENTOS
} = require("../../core/status");

function getPendingSingleRow(rows, headerMap, targetRowNumber) {
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const currentRowNumber = i + 1;

    if (targetRowNumber && currentRowNumber !== targetRowNumber) continue;

    const postTipo = getCellValue(row, headerMap, "post_tipo").toLowerCase();
    const estadoRender = getCellValue(row, headerMap, "estado_render").toLowerCase();
    const estadoUpload = getCellValue(row, headerMap, "estado_upload").toLowerCase();
    const estadoPublish = getCellValue(row, headerMap, "estado_publish").toLowerCase();
    const lockStatus = getCellValue(row, headerMap, "lock_status").toLowerCase();
    const intentos = Number(getCellValue(row, headerMap, "intentos") || 0);

    const isEligible =
      postTipo === POST_TIPOS.SINGLE &&
      estadoRender === STATUS.DONE &&
      estadoUpload === STATUS.DONE &&
      (estadoPublish === STATUS.PENDING || estadoPublish === STATUS.ERROR) &&
      (lockStatus === LOCK_STATUS.FREE || lockStatus === LOCK_STATUS.LOCKED) &&
      intentos < MAX_INTENTOS;

    if (isEligible) {
      return {
        rowNumber: currentRowNumber,
        values: row
      };
    }
  }

  return null;
}

async function main() {
  const cycleId = process.env.PIPELINE_CYCLE_ID || "";
  const targetRowNumber = process.env.TARGET_ROW_NUMBER
    ? Number(process.env.TARGET_ROW_NUMBER)
    : null;

  const log = logger.child({
    job: "publish-single",
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
    "facebook_post_id"
  ];

  requireHeaders(headerMap, requiredHeaders);

  const selectedRow = getPendingSingleRow(rows, headerMap, targetRowNumber);

  if (!selectedRow) {
    log.info("No hay singles pendientes para publish");
    process.exit(10);
  }

  const rowNumber = selectedRow.rowNumber;
  const row = selectedRow.values;

  const rowId = getCellValue(row, headerMap, "row_id");
  const imageUrl = getCellValue(row, headerMap, "media_url");
  const caption = getCellValue(row, headerMap, "caption");
  const cloudinaryPublicId = getCellValue(row, headerMap, "cloudinary_public_id");
  const currentAttempts = Number(getCellValue(row, headerMap, "intentos") || 0);

  const existingInstagramCreationId = getCellValue(row, headerMap, "instagram_creation_id");
  const existingInstagramMediaId = getCellValue(row, headerMap, "instagram_media_id");
  const existingFacebookPhotoId = getCellValue(row, headerMap, "facebook_photo_id");
  const existingFacebookPostId = getCellValue(row, headerMap, "facebook_post_id");

  const rowLogger = log.child({ rowNumber, rowId });

  if (!imageUrl) {
    throw new Error(`La fila ${rowNumber} no tiene media_url.`);
  }

  rowLogger.info("Fila seleccionada para publish", {
    hasCaption: Boolean(caption),
    imageUrl,
    hasExistingInstagram: Boolean(existingInstagramMediaId),
    hasExistingFacebook: Boolean(existingFacebookPostId)
  });

  const lockTs = nowIsoLocal();

  await updateCellsBatch(sheets, [
    { row: rowNumber, col: headerMap["estado_general"] + 1, value: GENERAL_STATUS.PROCESSING },
    { row: rowNumber, col: headerMap["estado_publish"] + 1, value: STATUS.PROCESSING },
    { row: rowNumber, col: headerMap["lock_status"] + 1, value: LOCK_STATUS.LOCKED },
    { row: rowNumber, col: headerMap["last_cycle_id"] + 1, value: cycleId },
    { row: rowNumber, col: headerMap["updated_at"] + 1, value: lockTs },
    { row: rowNumber, col: headerMap["error_step"] + 1, value: "" },
    { row: rowNumber, col: headerMap["error_message"] + 1, value: "" }
  ]);

  let instagramResult = {
    creationId: existingInstagramCreationId,
    mediaId: existingInstagramMediaId
  };

  let facebookResult = {
    photoId: existingFacebookPhotoId,
    postId: existingFacebookPostId
  };

  try {
    if (!instagramResult.mediaId) {
      instagramResult = await publishImagePost({ imageUrl, caption });

      await updateCellsBatch(sheets, [
        { row: rowNumber, col: headerMap["instagram_creation_id"] + 1, value: instagramResult.creationId || "" },
        { row: rowNumber, col: headerMap["instagram_media_id"] + 1, value: instagramResult.mediaId || "" },
        { row: rowNumber, col: headerMap["updated_at"] + 1, value: nowIsoLocal() }
      ]);
    }

    if (!facebookResult.postId) {
      facebookResult = await publishFacebookImagePost({ imageUrl, caption });

      await updateCellsBatch(sheets, [
        { row: rowNumber, col: headerMap["facebook_photo_id"] + 1, value: facebookResult.photoId || "" },
        { row: rowNumber, col: headerMap["facebook_post_id"] + 1, value: facebookResult.postId || "" },
        { row: rowNumber, col: headerMap["updated_at"] + 1, value: nowIsoLocal() }
      ]);
    }

    const doneTs = nowIsoLocal();

    await updateCellsBatch(sheets, [
      { row: rowNumber, col: headerMap["fecha_publicado"] + 1, value: doneTs },
      { row: rowNumber, col: headerMap["estado_publish"] + 1, value: STATUS.DONE },
      { row: rowNumber, col: headerMap["estado_general"] + 1, value: GENERAL_STATUS.PUBLISHED },
      { row: rowNumber, col: headerMap["lock_status"] + 1, value: LOCK_STATUS.FREE },
      { row: rowNumber, col: headerMap["updated_at"] + 1, value: doneTs },
      { row: rowNumber, col: headerMap["error_step"] + 1, value: "" },
      { row: rowNumber, col: headerMap["error_message"] + 1, value: "" }
    ]);

    rowLogger.info("Fila publicada correctamente", {
      instagramMediaId: instagramResult.mediaId || "",
      instagramCreationId: instagramResult.creationId || "",
      facebookPostId: facebookResult.postId || "",
      facebookPhotoId: facebookResult.photoId || ""
    });

    if (cloudinaryPublicId) {
      try {
        await deleteImage(cloudinaryPublicId);
        rowLogger.info("Asset de Cloudinary eliminado", { cloudinaryPublicId });
      } catch (deleteError) {
        rowLogger.warn("No se pudo eliminar el asset de Cloudinary", { cloudinaryPublicId }, deleteError);
      }
    }
  } catch (error) {
    const errorTs = nowIsoLocal();

    await updateCellsBatch(sheets, [
      { row: rowNumber, col: headerMap["instagram_creation_id"] + 1, value: instagramResult.creationId || "" },
      { row: rowNumber, col: headerMap["instagram_media_id"] + 1, value: instagramResult.mediaId || "" },
      { row: rowNumber, col: headerMap["facebook_photo_id"] + 1, value: facebookResult.photoId || "" },
      { row: rowNumber, col: headerMap["facebook_post_id"] + 1, value: facebookResult.postId || "" },
      { row: rowNumber, col: headerMap["estado_general"] + 1, value: GENERAL_STATUS.ERROR },
      { row: rowNumber, col: headerMap["estado_publish"] + 1, value: STATUS.ERROR },
      { row: rowNumber, col: headerMap["lock_status"] + 1, value: LOCK_STATUS.FREE },
      { row: rowNumber, col: headerMap["intentos"] + 1, value: currentAttempts + 1 },
      { row: rowNumber, col: headerMap["error_step"] + 1, value: "publish" },
      { row: rowNumber, col: headerMap["error_message"] + 1, value: error.message || String(error) },
      { row: rowNumber, col: headerMap["updated_at"] + 1, value: errorTs }
    ]);

    rowLogger.error("Error publicando fila", {}, error);
    throw error;
  }
}

main().catch((err) => {
  logger.error("Error en publish-single-from-sheet", {}, err);
  process.exit(1);
});