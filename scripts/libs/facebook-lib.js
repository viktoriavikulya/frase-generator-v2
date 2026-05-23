require("dotenv").config();

const { buildGraphUrl, buildGraphErrorMessage } = require("./graph-client");

const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;

function ensureEnv() {
  if (!FB_PAGE_ID) {
    throw new Error("Falta FB_PAGE_ID en .env");
  }

  if (!FB_PAGE_ACCESS_TOKEN) {
    throw new Error("Falta FB_PAGE_ACCESS_TOKEN en .env");
  }
}

async function graphPost(path, body) {
  const url = buildGraphUrl(path);

  const form = new URLSearchParams();

  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      value.forEach((item) => form.append(key, String(item)));
      continue;
    }

    form.append(key, String(value));
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
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
    const message = buildGraphErrorMessage(res, data, rawText);
    const error = new Error(message);

    error.status = res.status;
    error.responseBody = rawText;
    error.graphError = data?.error || null;

    throw error;
  }

  return data;
}

async function graphPostWithRetry(path, body, retries = 3, delayMs = 5000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await graphPost(path, body);
    } catch (error) {
      const isTransient = error.graphError?.code === 1 || error.status >= 500;

      if (isTransient && attempt < retries) {
        console.log(`Facebook error transitorio (intento ${attempt}/${retries}), reintentando en ${delayMs / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      throw error;
    }
  }
}

async function publishFacebookImagePost({ imageUrl, caption }) {
  ensureEnv();

  if (!imageUrl) {
    throw new Error("imageUrl es requerido.");
  }

  const safeCaption = typeof caption === "string" ? caption.trim() : "";

  console.log("Publicando imagen en Facebook...");
  console.log("imageUrl:", imageUrl);
  console.log("caption:", safeCaption || "[sin caption]");

  const published = await graphPostWithRetry(`${FB_PAGE_ID}/photos`, {
    url: imageUrl,
    caption: safeCaption,
    access_token: FB_PAGE_ACCESS_TOKEN
  });

  if (!published.id) {
    throw new Error("No se recibió id de la foto publicada en Facebook.");
  }

  return {
    photoId: published.id,
    postId: published.post_id || ""
  };
}

async function uploadUnpublishedFacebookPhoto({ imageUrl }) {
  ensureEnv();

  if (!imageUrl) {
    throw new Error("imageUrl es requerido para un slide de Facebook.");
  }

  const uploaded = await graphPostWithRetry(`${FB_PAGE_ID}/photos`, {
    url: imageUrl,
    published: false,
    access_token: FB_PAGE_ACCESS_TOKEN
  });

  if (!uploaded.id) {
    throw new Error(
      `No se recibió id de foto no publicada para ${imageUrl}`
    );
  }

  return uploaded.id;
}

async function publishFacebookCarouselPost({ imageUrls, caption }) {
  ensureEnv();

  if (!Array.isArray(imageUrls) || imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error("Un carrusel de Facebook debe tener entre 2 y 10 imágenes.");
  }

  const safeCaption = typeof caption === "string" ? caption.trim() : "";

  console.log(`Publicando carrusel en Facebook con ${imageUrls.length} imágenes...`);
  console.log("caption:", safeCaption || "[sin caption]");

  const mediaFbids = [];

  for (const imageUrl of imageUrls) {
    const mediaFbid = await uploadUnpublishedFacebookPhoto({ imageUrl });
    mediaFbids.push(mediaFbid);
  }

  const body = {
    message: safeCaption,
    access_token: FB_PAGE_ACCESS_TOKEN
  };

  mediaFbids.forEach((mediaFbid, index) => {
    body[`attached_media[${index}]`] = JSON.stringify({ media_fbid: mediaFbid });
  });

  const published = await graphPostWithRetry(`${FB_PAGE_ID}/feed`, body);

  if (!published.id) {
    throw new Error("No se recibió id del post del carrusel en Facebook.");
  }

  return {
    postId: published.id,
    mediaFbids
  };
}

module.exports = {
  publishFacebookImagePost,
  publishFacebookCarouselPost
};