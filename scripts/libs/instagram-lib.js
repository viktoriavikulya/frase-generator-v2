require("dotenv").config();

const { graphGet, graphPost } = require("./graph-client");

const IG_USER_ID = process.env.IG_USER_ID;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 20;

const TOKEN_EXPIRED_SUBCODES = new Set([460, 463, 467]);

function ensureEnv() {
  if (!IG_USER_ID) throw new Error("Falta IG_USER_ID en .env");
  if (!IG_ACCESS_TOKEN) throw new Error("Falta IG_ACCESS_TOKEN en .env");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfTokenError(graphError) {
  if (!graphError || graphError.code !== 190) return;

  const sub = graphError.error_subcode;

  if (TOKEN_EXPIRED_SUBCODES.has(sub)) {
    throw new Error(
      `[TOKEN VENCIDO] El IG_ACCESS_TOKEN expiró (code=190, subcode=${sub}). ` +
      "Renovalo en Meta for Developers → Herramientas → Explorador de la API Graph " +
      "y actualiza el secret IG_ACCESS_TOKEN en GitHub."
    );
  }

  if (sub === 458) {
    throw new Error(
      "[TOKEN REVOCADO] El usuario desautorizó la app (code=190, subcode=458). " +
      "Es necesario volver a autorizar la app y generar un token nuevo."
    );
  }

  throw new Error(
    `[TOKEN INVÁLIDO] El IG_ACCESS_TOKEN es inválido o fue revocado (code=190, subcode=${sub ?? "none"}). ` +
    "Verificá el valor del secret IG_ACCESS_TOKEN en GitHub."
  );
}

function buildGraphErrorMessage(res, data, rawText) {
  const error = data?.error;

  if (!error) {
    return `Graph API error ${res.status}${rawText ? `: ${rawText}` : ""}`;
  }

  const parts = [error.message || `Graph API error ${res.status}`];

  if (error.code !== undefined)          parts.push(`code=${error.code}`);
  if (error.error_subcode !== undefined) parts.push(`subcode=${error.error_subcode}`);
  if (error.error_user_title)            parts.push(`title=${error.error_user_title}`);
  if (error.error_user_msg)              parts.push(`user_msg=${error.error_user_msg}`);
  if (error.fbtrace_id)                  parts.push(`fbtrace_id=${error.fbtrace_id}`);

  return parts.join(" | ");
}

async function igGraphPost(path, body) {
  try {
    return await graphPost(path, body);
  } catch (err) {
    throwIfTokenError(err.graphError);
    throw err;
  }
}

async function igGraphGet(path, query = {}) {
  try {
    return await graphGet(path, query);
  } catch (err) {
    throwIfTokenError(err.graphError);
    throw err;
  }
}

async function createImageContainer({ imageUrl, caption }) {
  ensureEnv();

  const safeCaption = typeof caption === "string" ? caption.trim() : "";

  console.log("Creando contenedor de imagen...");
  console.log("imageUrl:", imageUrl);
  console.log("caption:", safeCaption || "[sin caption]");

  return igGraphPost(`${IG_USER_ID}/media`, {
    image_url: imageUrl,
    caption: safeCaption,
    access_token: IG_ACCESS_TOKEN
  });
}

async function getContainerStatus(creationId) {
  ensureEnv();

  return igGraphGet(`${creationId}`, {
    fields: "id,status_code,status",
    access_token: IG_ACCESS_TOKEN
  });
}

async function waitUntilContainerReady(creationId) {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const statusData = await getContainerStatus(creationId);
    const statusCode = statusData.status_code || statusData.status || "";

    console.log(`Container ${creationId} estado intento ${attempt}/${MAX_POLL_ATTEMPTS}: ${statusCode}`);

    if (statusCode === "FINISHED" || statusCode === "PUBLISHED") return statusData;
    if (statusCode === "ERROR")   throw new Error(`El contenedor ${creationId} falló con status_code=ERROR`);
    if (statusCode === "EXPIRED") throw new Error(`El contenedor ${creationId} expiró antes de publicarse`);

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`El contenedor ${creationId} no estuvo listo a tiempo para publicar`);
}

async function publishContainer({ creationId }) {
  ensureEnv();

  return igGraphPost(`${IG_USER_ID}/media_publish`, {
    creation_id: creationId,
    access_token: IG_ACCESS_TOKEN
  });
}

async function publishImagePost({ imageUrl, caption }) {
  const container = await createImageContainer({ imageUrl, caption });

  if (!container.id) throw new Error("No se recibió id de contenedor al crear media.");

  await waitUntilContainerReady(container.id);

  const published = await publishContainer({ creationId: container.id });

  if (!published.id) throw new Error("No se recibió id del post publicado.");

  return { creationId: container.id, mediaId: published.id };
}

async function createCarouselItemContainer({ imageUrl }) {
  ensureEnv();

  return igGraphPost(`${IG_USER_ID}/media`, {
    image_url: imageUrl,
    is_carousel_item: true,
    access_token: IG_ACCESS_TOKEN
  });
}

async function createCarouselContainer({ children, caption }) {
  ensureEnv();

  const safeCaption = typeof caption === "string" ? caption.trim() : "";

  return igGraphPost(`${IG_USER_ID}/media`, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption: safeCaption,
    access_token: IG_ACCESS_TOKEN
  });
}

async function publishCarouselPost({ imageUrls, caption }) {
  if (!Array.isArray(imageUrls) || imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error("Un carrusel debe tener entre 2 y 10 imágenes.");
  }

  const childIds = [];

  for (const imageUrl of imageUrls) {
    const child = await createCarouselItemContainer({ imageUrl });

    if (!child.id) throw new Error(`No se recibió id del item del carrusel para ${imageUrl}`);

    await waitUntilContainerReady(child.id);
    childIds.push(child.id);
  }

  const parent = await createCarouselContainer({ children: childIds, caption });

  if (!parent.id) throw new Error("No se recibió id del contenedor padre del carrusel.");

  await waitUntilContainerReady(parent.id);

  const published = await publishContainer({ creationId: parent.id });

  if (!published.id) throw new Error("No se recibió id del post del carrusel publicado.");

  return { creationId: parent.id, mediaId: published.id, childIds };
}

module.exports = { publishImagePost, publishCarouselPost };