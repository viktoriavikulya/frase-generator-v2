require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const { getSheetsAuth } = require("../../auth/google-auth");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SHEET_ID = process.env.SHEET_ID;
const SOURCE_WORKSHEET =
  process.env.CAROUSEL_PLAN_SOURCE_WORKSHEET ||
  process.env.SAVED_TWEETS_WORKSHEET_NAME ||
  "archivo_x";
const SOURCE_RANGE = process.env.CAROUSEL_PLAN_SOURCE_RANGE || "A:BZ";
const PLAN_WORKSHEET = process.env.CAROUSEL_PLAN_WORKSHEET || "plan_carruseles";
const WRITE_PLAN_TO_SHEET = !["0", "false", "no"].includes(
  String(process.env.CAROUSEL_PLAN_WRITE_SHEET || "true").toLowerCase()
);
const OUTPUT_PATH = path.resolve(
  process.env.CAROUSEL_PLAN_OUTPUT || path.join(ROOT, "output", "carousel-plan.json")
);

const MIN_SLIDES = 8;
const MAX_SLIDES = 10;
const TIER_3_MIN_QUALITY = 38;
const TIER_3_MAX_RISK = 6;

const PLAN_HEADERS = [
  "usar",
  "estado",
  "revisar",
  "grupo",
  "orden",
  "frase_final",
  "frase_original",
  "notas",
  "calidad",
  "riesgo",
  "nivel",
  "recomendacion_auto",
  "carrusel_id",
  "clave_plan",
  "fila_archivo_x",
  "generado_en"
];

const MANUAL_PLAN_FIELDS = [
  "estado",
  "notas",
  "usar",
  "frase_final"
];

if (!SHEET_ID) {
  throw new Error("Falta SHEET_ID en el .env");
}

async function getSheetsClient() {
  const auth = getSheetsAuth();
  const authClient = await auth.getClient();
  return google.sheets({ version: "v4", auth: authClient });
}

function normalizeValue(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeValue(value).toLowerCase();
}

function buildHeaderMap(headers) {
  const map = {};

  headers.forEach((header, index) => {
    const key = normalizeValue(header);
    if (!key) return;

    if (map[key] !== undefined) {
      throw new Error(`Encabezado duplicado detectado: ${key}`);
    }

    map[key] = index;
  });

  return map;
}

function cell(row, headerMap, key) {
  const index = headerMap[key];
  if (index === undefined) return "";
  return normalizeValue(row[index]);
}

function cellFromAny(row, headerMap, keys) {
  for (const key of keys) {
    const value = cell(row, headerMap, key);
    if (value) return value;
  }

  return "";
}

function numberCell(row, headerMap, key) {
  const value = Number(cell(row, headerMap, key));
  return Number.isFinite(value) ? value : 0;
}

function numberCellFromAny(row, headerMap, keys) {
  const value = Number(cellFromAny(row, headerMap, keys));
  return Number.isFinite(value) ? value : 0;
}

function normalizeRecommendation(value) {
  const normalized = normalizeKey(value);
  const map = {
    aprobada: "approved",
    aprobado: "approved",
    reescribir: "rewrite_needed",
    fecha: "seasonal",
    riesgo: "risky",
    rechazada: "reject",
    rechazado: "reject",
    rescatada: "reject",
    rescatado: "reject"
  };

  return map[normalized] || normalized;
}

function normalizeSeasonality(value) {
  const normalized = normalizeKey(value);
  const map = {
    vigente: "evergreen",
    fecha: "seasonal",
    evento: "seasonal_event",
    caducada: "expired_or_contextual"
  };

  return map[normalized] || normalized;
}

function getGroupField(headerMap) {
  const candidates = [
    process.env.CAROUSEL_PLAN_GROUP_FIELD,
    "grupo_carrusel",
    "carousel_group",
    "tema_principal"
  ].filter(Boolean);

  return candidates.find(field => headerMap[field] !== undefined) || "";
}

function getCandidateTier(candidate) {
  // NUEVO FLUJO: Solo usar frases aprobadas manualmente
  // decision_editorial puede ser: "pendiente", "aprobada", "descartada"
  // Solo usamos "aprobada"
  if (candidate.decision_editorial === "aprobada") return 1;
  
  // Rechazar cualquier otra decisión editorial
  return null;
}

function buildCandidate(row, headerMap, rowNumber, groupField) {
  const sourceText = cellFromAny(row, headerMap, ["source_text", "frase_original"]);
  const finalText = cellFromAny(row, headerMap, ["mona_version", "frase_final"]);
  const group = cell(row, headerMap, groupField);
  const decision = cell(row, headerMap, "decision_editorial");

  if (!sourceText || !group) return null;

  // NUEVO: Solo considerar frases que existan en la estructura manual
  // El grupo debe estar asignado y la decisión editorial debe ser "aprobada"
  if (!decision || decision.toLowerCase() !== "aprobada") {
    return null;
  }

  const candidate = {
    row_number: rowNumber,
    id:
      cell(row, headerMap, "archive_id") ||
      cell(row, headerMap, "id") ||
      cell(row, headerMap, "source_id") ||
      cellFromAny(row, headerMap, ["original_index", "fila_txt"]) ||
      String(rowNumber),
    group,
    source_text: sourceText,
    // Usar frase_final si existe, sino usar frase_original
    phrase: finalText || sourceText,
    final_text: finalText,
    decision_editorial: decision,
    // Legacy fields (for compatibility, can be empty or ignored)
    recommendation: "approved",
    quality_score: 0,
    risk_score: 0,
    seasonality: "evergreen",
    original_index: numberCellFromAny(row, headerMap, ["original_index", "fila_txt"])
  };

  const tier = getCandidateTier(candidate);
  if (!tier) return null;

  return {
    ...candidate,
    tier,
    needs_review: false  // Sin revisión automática, todo es decisión manual
  };
}

function compareCandidates(a, b) {
  return (
    a.tier - b.tier ||
    b.quality_score - a.quality_score ||
    a.risk_score - b.risk_score ||
    a.original_index - b.original_index ||
    a.row_number - b.row_number
  );
}

function slugify(value) {
  return normalizeValue(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "carousel";
}

function buildCarouselId(groupName) {
  return `car_${slugify(groupName)}`;
}

function buildPlansFromRows(rows) {
  if (!Array.isArray(rows) || rows.length < 2) {
    return { plans: [], skipped: [], groupField: "" };
  }

  const headerMap = buildHeaderMap(rows[0]);
  const groupField = getGroupField(headerMap);

  if (!groupField) {
    throw new Error("No se encontró columna de grupo: grupo_carrusel, carousel_group o tema_principal");
  }

  // NUEVO: Validar que existan las nuevas columnas de flujo manual
  const requiredFields = ["decision_editorial", "frase_original"];
  for (const field of requiredFields) {
    if (!headerMap[field]) {
      throw new Error(`Falta columna requerida para nuevo flujo manual: ${field}`);
    }
  }

  const groups = new Map();

  for (let i = 1; i < rows.length; i++) {
    const candidate = buildCandidate(rows[i], headerMap, i + 1, groupField);
    if (!candidate) continue;

    if (!groups.has(candidate.group)) {
      groups.set(candidate.group, []);
    }

    groups.get(candidate.group).push(candidate);
  }

  const plans = [];
  const skipped = [];

  for (const [groupName, candidates] of groups.entries()) {
    // Sin ordenamiento de tiers, todos son tier 1 (aprobados)
    // Solo ordenar por fila en el sheet
    const ordered = candidates.sort((a, b) => a.row_number - b.row_number);

    if (ordered.length < MIN_SLIDES) {
      skipped.push({
        group: groupName,
        candidates: ordered.length,
        reason: "fewer_than_8_candidates",
        min_required: MIN_SLIDES
      });
      continue;
    }

    const slides = ordered.slice(0, MAX_SLIDES).map((candidate, index) => ({
      order: index + 1,
      id: candidate.id,
      row_number: candidate.row_number,
      phrase: candidate.phrase,
      source_text: candidate.source_text,
      final_text: candidate.final_text,
      decision_editorial: candidate.decision_editorial,
      tier: candidate.tier,
      needs_review: false
    }));

    plans.push({
      carousel_id: buildCarouselId(groupName),
      group: groupName,
      min_slides: MIN_SLIDES,
      max_slides: MAX_SLIDES,
      candidate_count: ordered.length,
      slide_count: slides.length,
      slides
    });
  }

  // Ordenar por cantidad de slides descendente
  plans.sort((a, b) => b.slide_count - a.slide_count || a.group.localeCompare(b.group));
  skipped.sort((a, b) => b.candidates - a.candidates || a.group.localeCompare(b.group));

  return { plans, skipped, groupField };
}

async function readRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SOURCE_WORKSHEET}!${SOURCE_RANGE}`
  });

  return res.data.values || [];
}

function writePlanFile(payload) {
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function ensureWorksheet(sheets, worksheetName) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: "sheets.properties.title"
  });

  const exists = (meta.data.sheets || []).some(sheet => sheet.properties?.title === worksheetName);

  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: worksheetName
            }
          }
        }
      ]
    }
  });
}

async function readPlanRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${PLAN_WORKSHEET}!A:AZ`
  }).catch(err => {
    if (err.code === 400 || err.code === 404) return { data: { values: [] } };
    throw err;
  });

  return res.data.values || [];
}

function buildManualValueMap(rows) {
  if (!rows.length) return new Map();

  const headerMap = buildHeaderMap(rows[0]);
  const manualByKey = new Map();
  const keyField = findHeader(headerMap, ["clave_plan", "plan_key"]);

  if (!keyField) return manualByKey;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const planKey = cell(row, headerMap, keyField);

    if (!planKey) continue;

    const values = {
      estado: cellFromAny(row, headerMap, ["estado", "editor_status"]),
      notas: cellFromAny(row, headerMap, ["notas", "editor_notes"]),
      usar: cellFromAny(row, headerMap, ["usar", "use_in_publish"]),
      frase_final: cellFromAny(row, headerMap, ["frase_final", "publish_phrase"])
    };

    manualByKey.set(planKey, values);
  }

  return manualByKey;
}

function getPlanKey(plan, slide) {
  return `${plan.carousel_id}__${slide.id}`;
}

function getDefaultManualValues(slide) {
  return {
    estado: "pendiente_revision",
    notas: "",
    usar: "si",
    // Usar final_text si existe, sino source_text
    frase_final: slide.final_text || slide.source_text
  };
}

function getManualValues(planKey, slide, manualByKey) {
  const defaults = getDefaultManualValues(slide);
  const saved = manualByKey.get(planKey) || {};

  return {
    estado: translateManualStatus(saved.estado) || defaults.estado,
    notas: saved.notas || defaults.notas,
    usar: translateManualUse(saved.usar) || defaults.usar,
    frase_final: saved.frase_final || defaults.frase_final
  };
}

function findHeader(headerMap, candidates) {
  return candidates.find(field => headerMap[field] !== undefined) || "";
}

function cellFromAny(row, headerMap, candidates) {
  const field = findHeader(headerMap, candidates);
  return field ? cell(row, headerMap, field) : "";
}

function translateManualStatus(value) {
  const normalized = normalizeKey(value);
  const map = {
    pending_review: "pendiente",
    needs_review: "revisar",
    ready: "listo",
    done: "listo",
    rejected: "descartado"
  };

  return map[normalized] || value;
}

function translateManualUse(value) {
  const normalized = normalizeKey(value);
  const map = {
    yes: "si",
    true: "si",
    no: "no",
    false: "no",
    review_first: "revisar"
  };

  return map[normalized] || value;
}

function translateRecommendation(value) {
  const map = {
    approved: "aprobada",
    rewrite_needed: "reescribir",
    reject: "rescatada",
    risky: "riesgo",
    seasonal: "fecha"
  };

  return map[value] || value;
}

function translateTier(value) {
  // NUEVO: Solo tier 1 (aprobada)
  if (value === 1) return "1 aprobada";
  return "unknown";
}

function planToSheetValues(payload, manualByKey) {
  const rows = [];

  for (const plan of payload.plans) {
    for (const slide of plan.slides) {
      const planKey = getPlanKey(plan, slide);
      const manual = getManualValues(planKey, slide, manualByKey);

      rows.push([
        manual.usar,
        manual.estado,
        slide.needs_review ? "si" : "no",
        plan.group,
        slide.order,
        manual.frase_final,
        slide.source_text,
        manual.notas,
        slide.quality_score,
        slide.risk_score,
        translateTier(slide.tier),
        translateRecommendation(slide.recommendation),
        plan.carousel_id,
        planKey,
        slide.row_number,
        payload.generated_at
      ]);
    }
  }

  return [PLAN_HEADERS, ...rows];
}

async function writePlanWorksheet(sheets, payload) {
  await ensureWorksheet(sheets, PLAN_WORKSHEET);
  const existingRows = await readPlanRows(sheets);
  const manualByKey = buildManualValueMap(existingRows);
  const values = planToSheetValues(payload, manualByKey);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${PLAN_WORKSHEET}!A:AZ`
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${PLAN_WORKSHEET}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values
    }
  });

  return {
    worksheet: PLAN_WORKSHEET,
    rowsWritten: values.length - 1,
    manualRowsPreserved: [...manualByKey.keys()].length
  };
}

async function main() {
  const sheets = await getSheetsClient();
  const rows = await readRows(sheets);
  const { plans, skipped, groupField } = buildPlansFromRows(rows);
  const payload = {
    source_worksheet: SOURCE_WORKSHEET,
    group_field: groupField,
    min_slides: MIN_SLIDES,
    max_slides: MAX_SLIDES,
    workflow: "manual_curation_only",
    note: "Solo frases con decision_editorial=aprobada son incluidas",
    generated_at: new Date().toISOString(),
    plan_count: plans.length,
    skipped_count: skipped.length,
    plans,
    skipped
  };

  writePlanFile(payload);
  const sheetResult = WRITE_PLAN_TO_SHEET
    ? await writePlanWorksheet(sheets, payload)
    : null;

  console.log(`Plan guardado: ${OUTPUT_PATH}`);
  if (sheetResult) {
    console.log(`Pestaña actualizada: ${sheetResult.worksheet}`);
    console.log(`Slides escritos en Sheet: ${sheetResult.rowsWritten}`);
  }
  console.log(`Carruseles generados: ${plans.length}`);
  console.log(`Grupos omitidos: ${skipped.length}`);
  console.log(`Columna de grupo: ${groupField}`);
  console.log("Flujo: 100% manual - solo frases aprobadas");
}

if (require.main === module) {
  main().catch(err => {
    console.error("Error construyendo plan de carruseles:");
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  MIN_SLIDES,
  MAX_SLIDES,
  TIER_3_MIN_QUALITY,
  TIER_3_MAX_RISK,
  getCandidateTier,
  buildCandidate,
  buildPlansFromRows,
  planToSheetValues
};
