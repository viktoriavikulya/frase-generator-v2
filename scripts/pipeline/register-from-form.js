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

function generateCarouselId(frases) {
  const str = frases.map(f => f.toLowerCase().trim()).sort().join("||");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  // Incluimos timestamp para evitar colisiones entre carruseles con las mismas frases (reposts).
  return "car_" + Math.abs(hash).toString(16).slice(0, 8) + "_" + Date.now();
}

/**
 * Encuentra la primera fila vacía en el sheet buscando desde abajo hacia arriba.
 * "Vacía" significa que la columna frase_original no tiene valor.
 *
 * Usar rows.length + 1 era frágil: si había filas vacías en el medio o el sheet
 * tenía huecos por borrado, el script sobreescribía datos existentes.
 *
 * @param {Array} rows - Todas las filas del sheet (incluyendo header en [0])
 * @param {Object} headerMap - Mapa de nombre de columna → índice
 * @returns {number} Número de fila en Sheets (1-based) donde insertar
 */
function findNextEmptyRow(rows, headerMap) {
  // Recorremos desde la última fila hacia atrás buscando la primera con datos.
  // La fila a insertar es inmediatamente después de esa.
  for (let i = rows.length - 1; i >= 1; i--) {
    const value = getCellValue(rows[i], headerMap, "frase_original");
    if (value) {
      // Esta fila tiene datos → la siguiente es la primera vacía.
      return i + 2; // +1 por 1-based, +1 para ir a la siguiente
    }
  }

  // Si no encontramos ninguna fila con datos (sheet vacío excepto header),
  // la primera fila disponible es la 2.
  return 2;
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
    "lock_status", "modo", "updated_at"
  ];

  if (tipo === "carousel") {
    requiredHeaders.push("carousel_id", "carousel_order", "carousel_caption");
  } else {
    requiredHeaders.push("caption");
  }

  requireHeaders(headerMap, requiredHeaders);

  const carouselId = tipo === "carousel" ? generateCarouselId(frases) : "";
  const nextRow = findNextEmptyRow(rows, headerMap);

  console.log(`Primera fila vacía detectada: ${nextRow}`);

  if (tipo === "carousel" && process.env.GITHUB_ENV) {
    const fs = require("fs");
    fs.appendFileSync(process.env.GITHUB_ENV, `TARGET_CAROUSEL_ID=${carouselId}\n`);
  }

  if (tipo === "single" && process.env.GITHUB_ENV) {
    const fs = require("fs");
    fs.appendFileSync(process.env.GITHUB_ENV, `TARGET_ROW_NUMBER=${nextRow}\n`);
  }

  const hashtags = "#monacastrosa #frasesreales #humorcotidiano #vidareal";
  const now = nowIsoLocal();
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
    add("modo", "retro3d");
    add("updated_at", now);

    if (tipo === "carousel") {
      add("carousel_id", carouselId);
      add("carousel_order", i + 1);
      add("carousel_caption", caption);
    } else {
      add("caption", caption);
    }
  });

  await updateCellsBatch(sheets, updates);

  if (tipo === "carousel") {
    console.log(`✅ ${frases.length} frases registradas como pending — carousel_id: ${carouselId}, fila inicial: ${nextRow}`);
  } else {
    console.log(`✅ ${frases.length} frases registradas como pending — tipo: single, row: ${nextRow}`);
  }
}

main().catch(err => {
  console.error("Error registrando frases:", err);
  process.exit(1);
});