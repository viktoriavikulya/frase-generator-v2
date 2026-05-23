require("dotenv").config();

const THREADS_USER_ID = process.env.THREADS_USER_ID;
const THREADS_ACCESS_TOKEN = process.env.THREADS_ACCESS_TOKEN;
const THREADS_API_BASE = "https://graph.threads.net/v1.0";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 20;

const TOKEN_EXPIRED_SUBCODES = new Set([460, 463, 467]);

function ensureEnv() {
  if (!THREADS_USER_ID) throw new Error("Falta THREADS_USER_ID en .env");
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

async function threadsGet(path, query = {}) {
  const url = new URL(`${THREADS_API_BASE}/${path}`);

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url.toString());
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
    throw new Error(msg);
  }

  return data;
}

async function threadsPost(path, body) {
  const url = `${THREADS_API_BASE}/${path}`;

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== null) {
      form.append(key, String(value));
    }
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
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
    error.status = res.status;
    error.graphError = err || null;
    throw error;
  }

  return data;
}

async function getContainerStatus(containerId) {
  return threadsGet(`${containerId}`, {
    fields: "id,status,error_message",
    access_token: THREADS_ACCESS_TOKEN
  });
}

async function waitUntilContainerReady(containerId) {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const statusData = await getContainerStatus(containerId);
    const status = statusData.status || "";

    console.log(`Threads container ${containerId} estado intento ${attempt}/${MAX_POLL_ATTEMPTS}: ${status}`);

    if (status === "FINISHED") return statusData;
    if (status === "ERROR") throw new Error(`El contenedor de Threads ${containerId} falló: ${statusData.error_message || "error desconocido"}`);
    if (status === "EXPIRED") throw new Error(`El contenedor de Threads ${containerId} expiró antes de publicarse`);

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`El contenedor de Threads ${containerId} no estuvo listo a tiempo`);
}

async function publishThreadsImagePost({ imageUrl, caption }) {
  ensureEnv();

  if (!imageUrl) throw new Error("imageUrl es requerido para publicar en Threads.");

  const safeCaption = typeof caption === "string" ? caption.trim() : "";

  console.log("Creando contenedor de imagen en Threads...");
  console.log("imageUrl:", imageUrl);
  console.log("caption:", safeCaption || "[sin caption]");

  const container = await threadsPost(`${THREADS_USER_ID}/threads`, {
    media_type: "IMAGE",
    image_url: imageUrl,
    text: safeCaption,
    access_token: THREADS_ACCESS_TOKEN
  });

  if (!container.id) throw new Error("No se recibió id del contenedor de Threads.");

  await waitUntilContainerReady(container.id);

  const published = await threadsPost(`${THREADS_USER_ID}/threads_publish`, {
    creation_id: container.id,
    access_token: THREADS_ACCESS_TOKEN
  });

  if (!published.id) throw new Error("No se recibió id del post publicado en Threads.");

  console.log("Post publicado en Threads:", published.id);

  return { containerId: container.id, mediaId: published.id };
}

async function publishThreadsCarouselPost({ imageUrls, caption }) {
  ensureEnv();

  if (!Array.isArray(imageUrls) || imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error("Un carrusel de Threads debe tener entre 2 y 10 imágenes.");
  }

  const safeCaption = typeof caption === "string" ? caption.trim() : "";

  console.log(`Creando carrusel en Threads con ${imageUrls.length} imágenes...`);
  console.log("caption:", safeCaption || "[sin caption]");

  // Crear contenedores individuales de cada imagen
  const childIds = [];

  for (const imageUrl of imageUrls) {
    const child = await threadsPost(`${THREADS_USER_ID}/threads`, {
      media_type: "IMAGE",
      image_url: imageUrl,
      is_carousel_item: true,
      access_token: THREADS_ACCESS_TOKEN
    });

    if (!child.id) throw new Error(`No se recibió id del item del carrusel para ${imageUrl}`);

    childIds.push(child.id);
    console.log(`Slide de carrusel creado: ${child.id}`);
  }

  // Crear contenedor padre del carrusel
  const parent = await threadsPost(`${THREADS_USER_ID}/threads`, {
    media_type: "CAROUSEL",
    children: childIds.join(","),
    text: safeCaption,
    access_token: THREADS_ACCESS_TOKEN
  });

  if (!parent.id) throw new Error("No se recibió id del contenedor padre del carrusel de Threads.");

  await waitUntilContainerReady(parent.id);

  const published = await threadsPost(`${THREADS_USER_ID}/threads_publish`, {
    creation_id: parent.id,
    access_token: THREADS_ACCESS_TOKEN
  });

  if (!published.id) throw new Error("No se recibió id del carrusel publicado en Threads.");

  console.log("Carrusel publicado en Threads:", published.id);

  return { containerId: parent.id, mediaId: published.id, childIds };
}

module.exports = {
  publishThreadsImagePost,
  publishThreadsCarouselPost
};