require("dotenv").config();

const {
  getSheetsClient,
  buildHeaderMap,
  requireHeaders,
  getCellValue,
  readRows,
  updateCellsBatch
} = require("../core/sheets");

const { nowIsoLocal } = require("../utils/common");

const BG_SEQUENCE = ["#f4c400", "#3d5afe", "#e53935", "#f6f1e8", "#0d0f14"];

function getNextColor(rows, headerMap) {
  let latestTime = 0;
  let latestBg = "";

  for (let i = 1; i < rows.length; i++) {
    const estado = getCellValue(rows[i], headerMap, "estado_general");
    const bg = getCellValue(rows[i], headerMap, "background_color");
    const fecha = getCellValue(rows[i], headerMap, "fecha_publicado");

    if (estado !== "published" || !bg || !fecha) continue;

    try {
      const ts = new Date(fecha).getTime();
      if (ts > latestTime) {
        latestTime = ts;
        latestBg = bg.toLowerCase();
      }
    } catch (_) {}
  }

  if (!latestBg) return BG_SEQUENCE[0];
  const idx = BG_SEQUENCE.map(b => b.toLowerCase()).indexOf(latestBg);
  return idx === -1 ? BG_SEQUENCE[0] : BG_SEQUENCE[(idx + 1) % BG_SEQUENCE.length];
}

function generateCarouselId(frases) {
  const str = frases.map(f => f.toLowerCase().trim()).sort().join("||");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return "car_" + Math.abs(hash).toString(16).slice(0, 8);
}

async function main() {
  const frasesRaw = process.env.FRASES_INPUT || "";
  const caption = process.env.CAPTION_INPUT || "";
  const tipo = process.env.TIPO_INPUT === "single" ? "single" : "carousel";

  const frases = frasesRaw.split("||").map(f => f.trim()).filter(Boolean);

  if (frases.length < 1) {
    console.log("No hay frases suficientes, nada que registrar.");
    process.exit(0);
  }

  console.log(`Registrando ${frases.length} frases como ${tipo} con caption: "${caption}"`);

  const sheets = await getSheetsClient();
  const rows = await readRows(sheets);
  const headers = rows[0];
  const headerMap = buildHeaderMap(headers);

  const requiredHeaders = [
    "frase_original", "frase_corregida", "post_tipo", "hashtags",
    "estado_general", "estado_render", "estado_upload", "estado_publish",
    "lock_status", "background_color", "modo", "updated_at"
  ];

  if (tipo === "carousel") {
    requiredHeaders.push("carousel_id", "carousel_order", "carousel_caption");
  }

  requireHeaders(headerMap, requiredHeaders);

  const bgColor = getNextColor(rows, headerMap);
  const carouselId = tipo === "carousel" ? generateCarouselId(frases) : "";

  if (tipo === "carousel" && process.env.GITHUB_ENV) {
    const fs = require("fs");
    fs.appendFileSync(process.env.GITHUB_ENV, `TARGET_CAROUSEL_ID=${carouselId}\n`);
  }

  const hashtags = "#monacastrosa #frasesreales #humorcotidiano #vidareal";
  const now = nowIsoLocal();
  const nextRow = rows.length + 1;
  const updates = [];

  frases.forEach((frase, i) => {
    const row = nextRow + i;
    const add = (field, value) => {
      if (headerMap[field] !== undefined) {
        updates.push({ row, col: headerMap[field] + 1, value });
      }
    };

    add("frase_original", frase);
    add("frase_corregida", frase);
    add("post_tipo", tipo);
    add("hashtags", hashtags);
    add("estado_general", "pending");
    add("estado_render", "pending");
    add("estado_upload", "pending");
    add("estado_publish", "pending");
    add("lock_status", "free");
    add("background_color", bgColor);
    add("modo", "retro3d");
    add("updated_at", now);

    if (tipo === "carousel") {
      add("carousel_id", carouselId);
      add("carousel_order", i + 1);
      add("carousel_caption", caption);
    }
  });

  await updateCellsBatch(sheets, updates);

  if (tipo === "carousel") {
    console.log(`✅ ${frases.length} frases registradas como pending — carousel_id: ${carouselId}`);
  } else {
    console.log(`✅ ${frases.length} frases registradas como pending — tipo: single`);
  }
}

main().catch(err => {
  console.error("Error registrando frases:", err);
  process.exit(1);
});