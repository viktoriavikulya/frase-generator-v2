require("dotenv").config();

const { buildGraphErrorMessage, graphPost } = require("./graph-client");
const { logger } = require("../utils/logger");

const FB_PAGE_ID           = process.env.FB_PAGE_ID;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

function ensureEnv() {
  if (!FB_PAGE_ID)           throw new Error("Falta FB_PAGE_ID en .env");
  if (!FB_PAGE_ACCESS_TOKEN) throw new Error("Falta FB_PAGE_ACCESS_TOKEN en .env");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determina si un error de la Graph API es transitorio y vale la pena reintentar.
 * Alineado con el mismo criterio de threads-lib.js:
 *   - code 1 = error interno de Meta (transitorio)
 *   - HTTP 5xx = error de servidor (transitorio)
 * Los errores de auth (190) y validación (4xx) fallan inmediatamente.
 */
function isTransientError(error) {
  return error.graphError?.code === 1 || (error.status >= 500 && error.status < 600);
}

/**
 * Ejecuta fn hasta RETRY_ATTEMPTS veces, esperando RETRY_DELAY_MS entre intentos.
 * Solo reintenta si isTransientError(error) es true.
 */
async function withRetry(fn, label) {
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (isTransientError(error) && attempt < RETRY_ATTEMPTS) {
        logger.warn(`Facebook reintento (${label})`, {
          attempt,
          total:   RETRY_ATTEMPTS,
          error:   error.message
        });
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }
}

// ─── Funciones públicas ───────────────────────────────────────────────────────

async function publishFacebookImagePost({ imageUrl, caption }) {
  ensureEnv();

  if (!imageUrl) throw new Error("imageUrl es requerido.");

  const safeCaption = typeof caption === "string" ? caption.trim() : "";

  logger.info("Publicando imagen en Facebook", {
    imageUrl,
    caption: safeCaption || "[sin caption]"
  });

  const published = await withRetry(
    () => graphPost(`${FB_PAGE_ID}/photos`, {
      url:          imageUrl,
      caption:      safeCaption,
      access_token: FB_PAGE_ACCESS_TOKEN
    }),
    "publishFacebookImagePost"
  );

  if (!published.id) {
    throw new Error("No se recibió id de la foto publicada en Facebook.");
  }

  return {
    photoId: published.id,
    postId:  published.post_id || ""
  };
}

async function uploadUnpublishedFacebookPhoto({ imageUrl }) {
  ensureEnv();

  if (!imageUrl) throw new Error("imageUrl es requerido para un slide de Facebook.");

  const uploaded = await withRetry(
    () => graphPost(`${FB_PAGE_ID}/photos`, {
      url:          imageUrl,
      published:    false,
      access_token: FB_PAGE_ACCESS_TOKEN
    }),
    "uploadUnpublishedFacebookPhoto"
  );

  if (!uploaded.id) {
    throw new Error(`No se recibió id de foto no publicada para ${imageUrl}`);
  }

  return uploaded.id;
}

async function publishFacebookCarouselPost({ imageUrls, caption }) {
  ensureEnv();

  if (!Array.isArray(imageUrls) || imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error("Un carrusel de Facebook debe tener entre 2 y 10 imágenes.");
  }

  const safeCaption = typeof caption === "string" ? caption.trim() : "";

  logger.info("Publicando carrusel en Facebook", {
    slides:  imageUrls.length,
    caption: safeCaption || "[sin caption]"
  });

  const mediaFbids = [];

  for (const imageUrl of imageUrls) {
    const mediaFbid = await uploadUnpublishedFacebookPhoto({ imageUrl });
    mediaFbids.push(mediaFbid);
  }

  const body = {
    message:      safeCaption,
    access_token: FB_PAGE_ACCESS_TOKEN
  };

  mediaFbids.forEach((mediaFbid, index) => {
    body[`attached_media[${index}]`] = JSON.stringify({ media_fbid: mediaFbid });
  });

  const published = await withRetry(
    () => graphPost(`${FB_PAGE_ID}/feed`, body),
    "publishFacebookCarouselPost"
  );

  if (!published.id) {
    throw new Error("No se recibió id del post del carrusel en Facebook.");
  }

  return {
    postId:    published.id,
    mediaFbids
  };
}

module.exports = {
  publishFacebookImagePost,
  publishFacebookCarouselPost
};