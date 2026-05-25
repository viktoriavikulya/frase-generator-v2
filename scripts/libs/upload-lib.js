require("dotenv").config();

const path = require("path");
const { v2: cloudinary } = require("cloudinary");

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

if (!CLOUDINARY_CLOUD_NAME) {
  throw new Error("Falta CLOUDINARY_CLOUD_NAME en el .env");
}

if (!CLOUDINARY_API_KEY) {
  throw new Error("Falta CLOUDINARY_API_KEY en el .env");
}

if (!CLOUDINARY_API_SECRET) {
  throw new Error("Falta CLOUDINARY_API_SECRET en el .env");
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET
});

function sanitizeName(value) {
  return (value || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function buildPublicId(fileName) {
  if (!fileName) {
    throw new Error("buildPublicId requiere fileName.");
  }

  const baseName = path.parse(fileName).name;
  const safeBaseName = sanitizeName(baseName);

  if (!safeBaseName) {
    throw new Error(`Nombre de archivo invalido para Cloudinary: ${fileName}`);
  }

  return `mono_generator/${safeBaseName}`;
}

async function uploadImage(localPath, fileName) {
  if (!localPath) {
    throw new Error("uploadImage requiere localPath.");
  }

  if (!fileName) {
    throw new Error("uploadImage requiere fileName.");
  }

  const publicId = buildPublicId(fileName);

  const result = await cloudinary.uploader.upload(localPath, {
    public_id: publicId,
    overwrite: true,
    resource_type: "image"
  });

  return {
    publicId: result.public_id,
    secureUrl: result.secure_url,
    width: result.width,
    height: result.height,
    format: result.format
  };
}

async function deleteImage(publicId) {
  if (!publicId) {
    return {
      result: "skipped",
      reason: "missing_public_id"
    };
  }

  return cloudinary.uploader.destroy(publicId, {
    resource_type: "image"
  });
}

module.exports = {
  buildPublicId,
  uploadImage,
  deleteImage
};
