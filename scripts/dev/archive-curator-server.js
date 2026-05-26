require("dotenv").config();

const express = require("express");
const path = require("path");
const { google } = require("googleapis");

const { getSheetsAuth } = require("../auth/google-auth");
const { colToLetter, nowIsoLocal } = require("../utils/common");
const { DISPLAY_ORDER, TAXONOMY, normalizeGroupName } = require("../jobs/inspiration/taxonomy");

const ROOT = path.resolve(__dirname, "..", "..");
const SHEET_ID = process.env.SHEET_ID;
const WORKSHEET_NAME = process.env.SAVED_TWEETS_WORKSHEET_NAME || "archivo_x";
const PORT = Number(process.env.CURATOR_PORT || 5177);
const CURATOR_TOKEN = process.env.CURATOR_TOKEN;

const REQUIRED_HEADERS = [
  // Nueva estructura (flujo manual 100%)
  "id",
  "frase_original",
  "frase_final",
  "decision_editorial",
  "grupo_carrusel",
  "notas",
  "temporalidad",
  "temporada",
  "capturado_en",
  "actualizado_en",
  "lote_importacion",
  "fuente",
  // Legacy headers (deprecated, kept for compatibility)
  "sirve",
  "estado",
  "prioridad",
  "accion",
  "recomendacion_auto",
  "calidad",
  "riesgo",
  "subtema",
  "clasificado_manual"
];

const EDITABLE_FIELDS = new Set([
  "frase_final",
  "decision_editorial",
  "grupo_carrusel",
  "notas",
  "temporalidad",
  "temporada",       // CORRECCIÓN: faltaba este campo
  "actualizado_en"
]);

function getPublicTaxonomy() {
  return TAXONOMY
    .map(({ name, hint }) => ({ name, hint }))
    .sort((a, b) => {
      const aIndex = DISPLAY_ORDER.indexOf(a.name);
      const bIndex = DISPLAY_ORDER.indexOf(b.name);
      const safeA = aIndex === -1 ? DISPLAY_ORDER.length : aIndex;
      const safeB = bIndex === -1 ? DISPLAY_ORDER.length : bIndex;
      return safeA - safeB;
    });
}

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

function buildHeaderMap(headers) {
  const map = {};

  headers.forEach((header, index) => {
    const key = normalizeValue(header);
    if (!key) return;
    if (map[key] !== undefined) throw new Error(`Encabezado duplicado: ${key}`);
    map[key] = index;
  });

  return map;
}

async function readSheetRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${WORKSHEET_NAME}!A:BZ`
  });

  return res.data.values || [];
}

async function ensureHeaders(sheets, rows) {
  const currentHeaders = (rows[0] || []).map(normalizeValue);
  const seen = new Set(currentHeaders.filter(Boolean));
  const headers = [...currentHeaders];

  for (const header of REQUIRED_HEADERS) {
    if (!seen.has(header)) {
      headers.push(header);
      seen.add(header);
    }
  }

  if (!rows.length || headers.length !== currentHeaders.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${WORKSHEET_NAME}!A1:${colToLetter(headers.length)}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [headers] }
    });
  }

  return [headers, ...rows.slice(1)];
}

function cell(row, headerMap, key) {
  const index = headerMap[key];
  if (index === undefined) return "";
  return normalizeValue(row[index]);
}

function rowToPhrase(row, headerMap, rowNumber) {
  const phrase = { rowNumber };

  for (const header of Object.keys(headerMap)) {
    phrase[header] = cell(row, headerMap, header);
  }

  phrase.grupo_carrusel = normalizeGroupName(phrase.grupo_carrusel);
  return phrase;
}

function getSummary(items) {
  const summary = {
    total: items.length,
    pendiente: 0,
    aprobada: 0,
    descartada: 0,
    byGroup: {},
    byDecision: {}
  };

  for (const item of items) {
    const decision = item.decision_editorial?.toLowerCase() || "pendiente";
    const group = item.grupo_carrusel || "Sin grupo";

    if (decision === "aprobada") summary.aprobada += 1;
    else if (decision === "descartada") summary.descartada += 1;
    else summary.pendiente += 1;

    summary.byGroup[group] = (summary.byGroup[group] || 0) + 1;
    summary.byDecision[decision] = (summary.byDecision[decision] || 0) + 1;
  }

  return summary;
}

async function loadArchive(sheets) {
  const rows = await ensureHeaders(sheets, await readSheetRows(sheets));
  const headerMap = buildHeaderMap(rows[0] || []);
  const items = [];

  for (let i = 1; i < rows.length; i++) {
    const item = rowToPhrase(rows[i], headerMap, i + 1);
    if (!item.frase_original) continue;
    items.push(item);
  }

  return { headerMap, items };
}

function buildUpdates(rowNumber, headerMap, patch) {
  const updates = [];
  const nextPatch = {
    ...patch,
    actualizado_en: nowIsoLocal()
  };

  // Validar decision_editorial si se intenta cambiar
  if (nextPatch.decision_editorial) {
    const allowedDecisions = ["pendiente", "aprobada", "descartada"];
    const normalized = nextPatch.decision_editorial.toLowerCase();
    if (!allowedDecisions.includes(normalized)) {
      throw new Error(`decision_editorial debe ser uno de: ${allowedDecisions.join(", ")}`);
    }
    nextPatch.decision_editorial = normalized;
  }

  // Validar grupo_carrusel si se asigna
  if (nextPatch.grupo_carrusel) {
    nextPatch.grupo_carrusel = normalizeGroupName(nextPatch.grupo_carrusel);
  }

  // IMPORTANTE: NO cambiar automáticamente decision_editorial.
  // El usuario debe hacer clic en "Aprobar", "Descartar" o "Pendiente".

  for (const [field, rawValue] of Object.entries(nextPatch)) {
    if (!EDITABLE_FIELDS.has(field)) continue;
    if (headerMap[field] === undefined) continue;

    updates.push({
      range: `${WORKSHEET_NAME}!${colToLetter(headerMap[field] + 1)}${rowNumber}`,
      values: [[rawValue ?? ""]]
    });
  }

  return updates;
}

async function updateRow(sheets, rowNumber, patch) {
  let rows = await ensureHeaders(sheets, await readSheetRows(sheets));
  let headerMap = buildHeaderMap(rows[0] || []);
  const updates = buildUpdates(rowNumber, headerMap, patch);

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: updates
      }
    });
  }

  rows = await ensureHeaders(sheets, await readSheetRows(sheets));
  headerMap = buildHeaderMap(rows[0] || []);
  const row = rows[rowNumber - 1] || [];

  return rowToPhrase(row, headerMap, rowNumber);
}

async function main() {
  const app = express();
  const sheets = await getSheetsClient();

  app.use(express.json({ limit: "256kb" }));
  app.use(express.static(path.join(ROOT, "tools")));

  // Middleware de protección con token (solo para API /api/*)
  app.use("/api/", (req, res, next) => {
    if (!CURATOR_TOKEN) {
      return next();
    }

    const token = req.headers["x-curator-token"] || req.query.token;
    if (token !== CURATOR_TOKEN) {
      return res.status(403).json({ error: "Token de curador inválido o faltante" });
    }
    next();
  });

  app.get("/api/taxonomy", (_req, res) => {
    res.json({ taxonomy: getPublicTaxonomy() });
  });

  app.get("/api/phrases", async (_req, res, next) => {
    try {
      const { items } = await loadArchive(sheets);
      res.json({
        worksheet: WORKSHEET_NAME,
        taxonomy: getPublicTaxonomy(),
        summary: getSummary(items),
        items
      });
    } catch (err) {
      next(err);
    }
  });

  app.patch("/api/phrases/:rowNumber", async (req, res, next) => {
    try {
      const rowNumber = Number(req.params.rowNumber);
      if (!Number.isInteger(rowNumber) || rowNumber < 2) {
        res.status(400).json({ error: "rowNumber inválido" });
        return;
      }

      const patch = req.body || {};

      // Validar grupo_carrusel si se proporciona
      if (patch.grupo_carrusel) {
        const normalized = normalizeGroupName(patch.grupo_carrusel);
        if (!TAXONOMY.some(item => item.name === normalized)) {
          res.status(400).json({ error: "grupo_carrusel no pertenece a la taxonomía" });
          return;
        }
        patch.grupo_carrusel = normalized;
      }

      // Validar decision_editorial si se proporciona
      if (patch.decision_editorial) {
        const allowedDecisions = ["pendiente", "aprobada", "descartada"];
        const normalized = patch.decision_editorial.toLowerCase();
        if (!allowedDecisions.includes(normalized)) {
          res.status(400).json({
            error: `decision_editorial debe ser uno de: ${allowedDecisions.join(", ")}`
          });
          return;
        }
      }

      const item = await updateRow(sheets, rowNumber, patch);
      res.json({ ok: true, item });
    } catch (err) {
      next(err);
    }
  });

  app.use((_req, res) => {
    res.sendFile(path.join(ROOT, "tools", "archivo-x-curator.html"));
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message || String(err) });
  });

  app.listen(PORT, () => {
    console.log(`Curador archivo_x: http://localhost:${PORT}`);
    console.log(`Pestaña: ${WORKSHEET_NAME}`);
    console.log("Flujo: Curaduría 100% manual");
    console.log("Decisiones editoriales: pendiente, aprobada, descartada");
    if (process.env.CURATOR_TOKEN) {
      console.log("⚠️  CURATOR_TOKEN está establecido - protección habilitada");
    } else {
      console.log("⚠️  CURATOR_TOKEN no está establecido - modo desarrollo sin protección");
    }
  });
}

main().catch(err => {
  console.error("No se pudo iniciar el curador de archivo_x:");
  console.error(err);
  process.exit(1);
});