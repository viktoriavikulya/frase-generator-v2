require("dotenv").config();

const { logger } = require("../utils/logger"); // MEJORA #13: logger estructurado en lugar de console.log

const THREADS_USER_ID       = process.env.THREADS_USER_ID;
const THREADS_ACCESS_TOKEN  = process.env.THREADS_ACCESS_TOKEN;
const THREADS_API_BASE      = "https://graph.threads.net/v1.0";

const POLL_INTERVAL_MS  = 3000;
const MAX_POLL_ATTEMPTS = 20;

const TOKEN_EXPIRED_SUBCODES = new Set([460, 463, 467]);

function ensureEnv() {
  if (!THREADS_USER_ID)      throw new Error("Falta THREADS_USER_ID en .env");
  if (!THREADS_ACCESS_TOKEN) throw new Error("Falta THREADS_ACCESS_TOKEN en .env");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfTokenError(graphError) {
  if (!graphError || graphError.code !== 190) return;

  const sub = graphError.error_subcode;

  if (TOKEN_EXPIRED_SUBCODES.has(sub)) {
    throw new Error(
      `[TOKEN VENCIDO] El THREADS_ACCESS_TOKEN expiró (code=190, subcode=${sub}). ` +
      "Renovalo en Meta for Developers → tu app → Threads → Generador de tokens " +
      "y actualiza el secret THREADS_ACCESS_TOKEN en GitHub."
    );
  }

  if (sub === 458) {
    throw new Error(
      "[TOKEN REVOCADO] El usuario desautorizó la app de Threads (code=190, subcode=458). " +
      "Es necesario volver a autorizar la app y generar un token nuevo."
    );
  }

  throw new Error(
    `[TOKEN INVÁLIDO] El THREADS_ACCESS_TOKEN es inválido o fue revocado (code=190, subcode=${sub ?? "none"}). ` +
    "Verificá el valor del secret THREADS_ACCESS_TOKEN en GitHub."
  );
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

/**
 * Determina si un error es transitorio y vale la pena reintentar.
 * - code 1 de la Graph API = error interno de Meta (transitorio)
 * - HTTP 5xx = error de servidor (transitorio)
 * Los errores de autenticación (code 190) y de validación (4xx) no se reintentan.
 */
function isTransientError(error) {
  return error.graphError?.code === 1 || (error.status >= 500 && error.status < 600);
}

/**
 * Ejecuta fn hasta `retries` veces, esperando `delayMs` entre intentos.
 * Solo reintenta si isTransientError(error) es true.
 */
async function withRetry(fn, { retries = RETRY_ATTEMPTS, delayMs = RETRY_DELAY_MS, onRetry } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (isTransientError(error) && attempt < retries) {
        if (onRetry) onRetry(attempt, retries, error);
        await sleep(delayMs);
        continue;
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP primitives (con retry en errores transitorios)
// ---------------------------------------------------------------------------

async function threadsGet(path, query = {}) {
  return withRetry(
    async () => {
      const url = new URL(`${THREADS_API_BASE}/${path}`);

      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }

      const res     = await fetch(url.toString());
      const rawText = await res.text();

      let data;
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = null;
      }

      if (!res.ok || data?.error) {
        throwIfTokenError(data?.error);
        const err = data?.error;
        const msg = err
          ? `${err.message} | code=${err.code} | fbtrace_id=${err.fbtrace_id}`
          : `Threads API ${res.status}: ${rawText}`;
        const error = new Error(msg);
        error.status     = res.status;
        error.graphError = err || null;
        throw error;
      }

      return data;
    },
    {
      onRetry: (attempt, total, err) =>
        logger.warn("threadsGet reintento", { path, attempt, total, error: err.message })
    }
  );
}

async function threadsPost(path, body) {
  return withRetry(
    async () => {
      const url = `${THREADS_API_BASE}/${path}`;

      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined && value !== null) {
          form.append(key, String(value));
        }
      }

      const res = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    form.toString()
      });

      const rawText = await res.text();

      let data;
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = null;
      }

      if (!res.ok || data?.error) {
        throwIfTokenError(data?.error);
        const err = data?.error;
        const msg = err
          ? `${err.message} | code=${err.code} | fbtrace_id=${err.fbtrace_id}`
          : `Threads API ${res.status}: ${rawText}`;

        const error = new Error(msg);
        error.status      = res.status;
        error.graphError  = err || null;
        throw error;
      }

      return data;
    },
    {
      onRetry: (attempt, total, err) =>
        logger.warn("threadsPost reintento", { path, attempt, total, error: err.message })
    }
  );
}

// ---------------------------------------------------------------------------
// Container polling
// ---------------------------------------------------------------------------

async function getContainerStatus(containerId) {
  return threadsGet(`${containerId}`, {
    fields:       "id,status,error_message",
    access_token: THREADS_ACCESS_TOKEN
  });
}

async function waitUntilContainerReady(containerId) {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const statusData = await getContainerStatus(containerId);
    const status     = statusData.status || "";

    logger.info("Threads container estado", { containerId, attempt, maxAttempts: MAX_POLL_ATTEMPTS, status });

    if (status === "FINISHED") return statusData;
    if (status === "ERROR")    throw new Error(`El contenedor de Threads ${containerId} falló: ${statusData.error_message || "error desconocido"}`);
    if (status === "EXPIRED")  throw new Error(`El contenedor de Threads ${containerId} expiró antes de publicarse`);

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`El contenedor de Threads ${containerId} no estuvo listo a tiempo`);
}

// ---------------------------------------------------------------------------
// Publish con retry de propagación
// ---------------------------------------------------------------------------
// Un contenedor puede reportar FINISHED y aun así no estar disponible para
// threads_publish durante unos segundos (consistencia eventual entre backends
// de Meta). En ese caso el publish falla con "Media Not Found" (code=24,
// subcode=4279009, is_transient=false) aunque el media exista — lo acabamos de
// ver FINISHED. Ese error solo es seguro de reintentar AQUÍ, justo después de
// un FINISHED confirmado; en cualquier otro contexto es un error permanente
// legítimo, por eso NO se agrega a isTransientError (retry global).

const PARENT_PUBLISH_DELAY_MS      = 8000;
const PROPAGATION_RETRY_ATTEMPTS   = 5;
const PROPAGATION_RETRY_DELAYS_MS  = [5000, 10000, 15000, 20000];

function isThreadsMediaNotFound(error) {
  const graphError = error?.graphError || {};
  const message = graphError.message || error?.message || "";
  return (
    graphError.code === 24 &&
    graphError.error_subcode === 4279009 &&
    (
      graphError.error_user_title === "Media Not Found" ||
      message.includes("requested resource does not exist") ||
      message.includes("Media Not Found")
    )
  );
}

async function publishThreadsContainerWithPropagationRetry(creationId, context = {}) {
  for (let attempt = 1; attempt <= PROPAGATION_RETRY_ATTEMPTS; attempt++) {
    try {
      return await threadsPost(`${THREADS_USER_ID}/threads_publish`, {
        creation_id:  creationId,
        access_token: THREADS_ACCESS_TOKEN
      });
    } catch (error) {
      if (!isThreadsMediaNotFound(error) || attempt >= PROPAGATION_RETRY_ATTEMPTS) {
        throw error;
      }

      const delayMs = PROPAGATION_RETRY_DELAYS_MS[Math.min(attempt - 1, PROPAGATION_RETRY_DELAYS_MS.length - 1)];
      logger.warn("Threads media todavía no está disponible para publish; reintentando", {
        ...context,
        creationId,
        attempt,
        maxAttempts: PROPAGATION_RETRY_ATTEMPTS,
        delayMs,
        code: error?.graphError?.code,
        error_subcode: error?.graphError?.error_subcode,
        fbtrace_id: error?.graphError?.fbtrace_id
      });

      await sleep(delayMs);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function publishThreadsImagePost({ imageUrl, caption }) {
  ensureEnv();

  if (!imageUrl) throw new Error("imageUrl es requerido para publicar en Threads.");

  const safeCaption = typeof caption === "string" ? caption.trim() : "";

  logger.info("Creando contenedor de imagen en Threads", { imageUrl, caption: safeCaption || "[sin caption]" });

  const container = await threadsPost(`${THREADS_USER_ID}/threads`, {
    media_type:   "IMAGE",
    image_url:    imageUrl,
    text:         safeCaption,
    access_token: THREADS_ACCESS_TOKEN
  });

  if (!container.id) throw new Error("No se recibió id del contenedor de Threads.");

  await waitUntilContainerReady(container.id);

  const published = await threadsPost(`${THREADS_USER_ID}/threads_publish`, {
    creation_id:  container.id,
    access_token: THREADS_ACCESS_TOKEN
  });

  if (!published.id) throw new Error("No se recibió id del post publicado en Threads.");

  logger.info("Post publicado en Threads", { mediaId: published.id });

  return { containerId: container.id, mediaId: published.id };
}

async function publishThreadsCarouselPost({ imageUrls, caption }) {
  ensureEnv();

  if (!Array.isArray(imageUrls) || imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error("Un carrusel de Threads debe tener entre 2 y 10 imágenes.");
  }

  const safeCaption = typeof caption === "string" ? caption.trim() : "";

  logger.info("Creando carrusel en Threads", { slides: imageUrls.length, caption: safeCaption || "[sin caption]" });

  const childIds = [];

  for (const imageUrl of imageUrls) {
    const child = await threadsPost(`${THREADS_USER_ID}/threads`, {
      media_type:       "IMAGE",
      image_url:        imageUrl,
      is_carousel_item: true,
      access_token:     THREADS_ACCESS_TOKEN
    });

    if (!child.id) throw new Error(`No se recibió id del item del carrusel para ${imageUrl}`);

    logger.info("Slide de carrusel creado, esperando que esté listo...", { containerId: child.id, imageUrl });

    await waitUntilContainerReady(child.id);

    childIds.push(child.id);
    logger.info("Slide de carrusel listo", { containerId: child.id, imageUrl });
  }

  const parent = await threadsPost(`${THREADS_USER_ID}/threads`, {
    media_type:   "CAROUSEL",
    children:     childIds.join(","),
    text:         safeCaption,
    access_token: THREADS_ACCESS_TOKEN
  });

  if (!parent.id) throw new Error("No se recibió id del contenedor padre del carrusel de Threads.");

  await waitUntilContainerReady(parent.id);

  logger.info("Threads parent container listo; esperando propagación antes de publicar", {
    containerId: parent.id,
    delayMs: PARENT_PUBLISH_DELAY_MS
  });
  await sleep(PARENT_PUBLISH_DELAY_MS);

  const published = await publishThreadsContainerWithPropagationRetry(parent.id, {
    job: "publish-threads-carousel",
    slides: imageUrls.length
  });

  if (!published.id) throw new Error("No se recibió id del carrusel publicado en Threads.");

  logger.info("Carrusel publicado en Threads", { mediaId: published.id, childIds });

  return { containerId: parent.id, mediaId: published.id, childIds };
}

module.exports = {
  threadsGet,
  publishThreadsImagePost,
  publishThreadsCarouselPost
};