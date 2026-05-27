require("dotenv").config();

const {
  getSheetsClient,
  buildHeaderMap,
  getCellValue,
  readRows
} = require("../core/sheets");

const REQUIRED_HEADERS = [
  "row_id",
  "frase_original",
  "frase_corregida",
  "post_tipo",
  "estado_general",
  "estado_render",
  "estado_upload",
  "estado_publish",
  "lock_status",
  "intentos",
  "updated_at",
  "background_color",
  "output_file",
  "media_url",
  "cloudinary_public_id",
  "instagram_media_id",
  "facebook_post_id",
  "threads_media_id"
];

const OPTIONAL_HEADERS = [
  "instagram_error",
  "facebook_error",
  "threads_error",
  "carousel_id",
  "carousel_order",
  "caption",
  "carousel_caption"
];

function normalizePhrase(value) {
  return (value || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function printFinding(level, message, context = {}) {
  const suffix = Object.keys(context).length
    ? ` ${JSON.stringify(context)}`
    : "";
  console.log(`${level} ${message}${suffix}`);
}

async function main() {
  const sheets = await getSheetsClient();
  const rows = await readRows(sheets);

  if (rows.length < 1) {
    throw new Error("La hoja no tiene encabezados.");
  }

  const headerMap = buildHeaderMap(rows[0]);
  let warnings = 0;
  let errors = 0;

  for (const header of REQUIRED_HEADERS) {
    if (!(header in headerMap)) {
      printFinding("FAIL", "Falta columna requerida", { header });
      errors++;
    }
  }

  for (const header of OPTIONAL_HEADERS) {
    if (!(header in headerMap)) {
      printFinding("WARN", "Falta columna opcional", { header });
      warnings++;
    }
  }

  const phraseMap = new Map();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1;

    const rowId = getCellValue(row, headerMap, "row_id");
    const postTipo = getCellValue(row, headerMap, "post_tipo").toLowerCase();
    const estadoGeneral = getCellValue(row, headerMap, "estado_general").toLowerCase();
    const estadoRender = getCellValue(row, headerMap, "estado_render").toLowerCase();
    const estadoUpload = getCellValue(row, headerMap, "estado_upload").toLowerCase();
    const estadoPublish = getCellValue(row, headerMap, "estado_publish").toLowerCase();
    const lockStatus = getCellValue(row, headerMap, "lock_status").toLowerCase();
    const outputFile = getCellValue(row, headerMap, "output_file");
    const mediaUrl = getCellValue(row, headerMap, "media_url");
    const phrase = normalizePhrase(
      getCellValue(row, headerMap, "frase_corregida") ||
      getCellValue(row, headerMap, "frase_original")
    );

    if (!rowId && phrase) {
      if (estadoGeneral === "published") {
        printFinding("WARN", "Fila publicada legacy sin row_id", { rowNumber });
        warnings++;
      } else {
        printFinding("FAIL", "Fila activa con frase pero sin row_id", { rowNumber, estadoGeneral });
        errors++;
      }
    }

    if (lockStatus === "locked" && estadoGeneral !== "processing") {
      printFinding("WARN", "Fila locked sin estado processing", { rowNumber, rowId, estadoGeneral });
      warnings++;
    }

    if (estadoRender === "done" && estadoUpload !== "done" && !outputFile) {
      printFinding("WARN", "Render done sin output_file", { rowNumber, rowId });
      warnings++;
    }

    if (estadoUpload === "done" && !mediaUrl) {
      printFinding("FAIL", "Upload done sin media_url", { rowNumber, rowId });
      errors++;
    }

    if (estadoPublish === "done" && estadoGeneral !== "published") {
      printFinding("WARN", "Publish done sin estado_general published", { rowNumber, rowId, estadoGeneral });
      warnings++;
    }

    if (phrase && estadoGeneral !== "published") {
      const key = `${postTipo}:${phrase}`;
      const existing = phraseMap.get(key);

      if (existing) {
        printFinding("WARN", "Frase duplicada no publicada", {
          firstRow: existing.rowNumber,
          rowNumber,
          postTipo,
          rowId
        });
        warnings++;
      } else {
        phraseMap.set(key, { rowNumber, rowId });
      }
    }
  }

  console.log("");
  console.log(`Doctor sheet: ${rows.length - 1} filas revisadas, ${warnings} WARN, ${errors} FAIL`);

  if (errors > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`FAIL doctor-sheet: ${err.message || String(err)}`);
  process.exit(1);
});
