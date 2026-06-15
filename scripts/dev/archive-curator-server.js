require("dotenv").config();

const express = require("express");
const path = require("path");
const { google } = require("googleapis");

const { getSheetsAuth } = require("../auth/google-auth");
const { colToLetter, nowIsoLocal } = require("../utils/common");
const { DISPLAY_ORDER, TAXONOMY, normalizeGroupName } = require("../jobs/inspiration/taxonomy");
const { registerFrases } = require("../pipeline/register-from-form");

const ROOT = path.resolve(__dirname, "..", "..");
const SHEET_ID = process.env.SHEET_ID;
const WORKSHEET_NAME = process.env.SAVED_TWEETS_WORKSHEET_NAME || "archivo_x";
const PORT = Number(process.env.CURATOR_PORT || 5177);
const CURATOR_TOKEN = process.env.CURATOR_TOKEN;

const REQUIRED_HEADERS = [
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
  "fuente"
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

async function getWorksheetId(sheets) {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: "sheets.properties"
  });

  const sheet = (res.data.sheets || []).find((item) => (
    item.properties?.title === WORKSHEET_NAME
  ));

  if (!sheet) {
    throw new Error(`No existe la pestaña "${WORKSHEET_NAME}"`);
  }

  return sheet.properties.sheetId;
}

function hasExpectedHeaderRow(headers) {
  return headers[0] === "id" && headers[1] === "frase_original";
}

async function insertHeaderRow(sheets) {
  const sheetId = await getWorksheetId(sheets);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          insertDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: 0,
              endIndex: 1
            },
            inheritFromBefore: false
          }
        }
      ]
    }
  });
}

async function ensureHeaders(sheets, rows) {
  const currentHeaders = (rows[0] || []).map(normalizeValue);

  if (rows.length > 0 && !hasExpectedHeaderRow(currentHeaders)) {
    await insertHeaderRow(sheets);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${WORKSHEET_NAME}!A1:${colToLetter(REQUIRED_HEADERS.length)}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [REQUIRED_HEADERS] }
    });

    return [REQUIRED_HEADERS, ...rows];
  }

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

function isHeaderLikeItem(item) {
  return item.id === "id" &&
    item.frase_original === "frase_original" &&
    item.decision_editorial === "decision_editorial";
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
    if (isHeaderLikeItem(item)) continue;
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

  const allowedOrigins = new Set([
    "https://imgifra.github.io",
    "http://localhost:5173",
    "http://localhost:5177",
    "http://localhost:5181",
    "http://localhost:5182",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5177",
    "http://127.0.0.1:5181",
    "http://127.0.0.1:5182"
  ]);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.has(origin) || origin.endsWith(".github.io"))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Curator-Token");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

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

  app.get("/api/plan-carruseles", async (_req, res, next) => {
    try {
      const { items } = await loadArchive(sheets);

      const groups = {};

      for (const item of items) {
        if (item.decision_editorial.toLowerCase() !== "aprobada") continue;

        const grupo = item.grupo_carrusel || "Sin grupo";
        if (!groups[grupo]) groups[grupo] = [];
        groups[grupo].push(item);
      }

      res.json({ worksheet: WORKSHEET_NAME, groups });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/plan-carruseles/registrar", async (req, res, next) => {
    try {
      const { rowNumbers, caption, color } = req.body || {};

      if (!Array.isArray(rowNumbers) || rowNumbers.length < 1 || rowNumbers.length > 10) {
        res.status(400).json({ error: "rowNumbers debe ser un array de 1 a 10 elementos" });
        return;
      }

      const uniqueRowNumbers = [...new Set(rowNumbers.map(Number))];

      if (uniqueRowNumbers.some((n) => !Number.isInteger(n) || n < 2)) {
        res.status(400).json({ error: "rowNumbers debe contener enteros >= 2 (fila 1 es el encabezado)" });
        return;
      }

      const { headerMap, items } = await loadArchive(sheets);
      const itemsByRow = new Map(items.map((item) => [item.rowNumber, item]));

      const selected = [];

      for (const rowNumber of uniqueRowNumbers) {
        const item = itemsByRow.get(rowNumber);

        if (!item) {
          res.status(400).json({ error: `No existe la fila ${rowNumber} en "${WORKSHEET_NAME}"` });
          return;
        }

        if (item.decision_editorial.toLowerCase() !== "aprobada") {
          res.status(400).json({ error: `La fila ${rowNumber} no tiene decision_editorial = "aprobada"` });
          return;
        }

        selected.push(item);
      }

      const grupos = new Set(selected.map((item) => item.grupo_carrusel));

      if (grupos.size > 1) {
        res.status(400).json({
          error: `Todas las filas deben pertenecer al mismo grupo_carrusel. Recibidos: ${[...grupos].join(", ")}`
        });
        return;
      }

      const frases = selected.map((item) => item.frase_final || item.frase_original);

      if (frases.some((frase) => !frase)) {
        res.status(400).json({ error: "Alguna fila seleccionada no tiene frase_final ni frase_original" });
        return;
      }

      const tipo = frases.length === 1 ? "single" : "carousel";

      const result = await registerFrases(sheets, {
        tipo,
        frases,
        caption: caption || "",
        colorInput: color || "",
        allowDuplicate: false
      });

      const response = {
        success: true,
        tipo,
        carouselId: result.carouselId,
        nextRow: result.nextRow,
        rowIds: result.rowIds,
        registeredRows: uniqueRowNumbers
      };

      // El registro en Hoja 2 ya ocurrió y es irreversible — si este marcado
      // falla, no lo tratamos como error de la request, solo lo avisamos.
      // decision_editorial = "publicada" saca la fila de /api/plan-carruseles
      // (filtra por "aprobada") y de las vistas "Pendientes"/"Aprobadas"/
      // "Descartadas" del curador (solo "Todas" la mostraría).
      try {
        const markUpdates = uniqueRowNumbers.flatMap((rowNumber) => [
          {
            range: `${WORKSHEET_NAME}!${colToLetter(headerMap["decision_editorial"] + 1)}${rowNumber}`,
            values: [["publicada"]]
          },
          {
            range: `${WORKSHEET_NAME}!${colToLetter(headerMap["actualizado_en"] + 1)}${rowNumber}`,
            values: [[nowIsoLocal()]]
          }
        ]);

        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SHEET_ID,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data: markUpdates
          }
        });
      } catch (markErr) {
        response.warning =
          `Registrado en Hoja 2, pero no se pudo marcar "${WORKSHEET_NAME}" como publicada ` +
          `(filas ${uniqueRowNumbers[0]}-${uniqueRowNumbers[uniqueRowNumbers.length - 1]} podrían ` +
          `reaparecer en GET /api/plan-carruseles): ${markErr.message || markErr}`;
      }

      res.json(response);
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
