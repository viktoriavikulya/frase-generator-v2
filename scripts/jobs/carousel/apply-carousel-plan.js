require("dotenv").config();

// La hoja objetivo se puede pasar como argumento: node apply-carousel-plan.js "Hoja 2"
// Si no se pasa, usa este valor por defecto.
const PLAN_WORKSHEET = process.argv[2] || "Hoja 2";

const { getSheetsAuth } = require("../../auth/google-auth");
const { google } = require("googleapis");
const {
  buildHeaderMap,
  requireHeaders,
  getCellValue,
  updateCellsBatch
} = require("../../core/sheets");

const { colToLetter, nowIsoLocal } = require("../../utils/common");

const SHEET_ID = process.env.SHEET_ID;
const SHEET_RANGE = process.env.SHEET_RANGE || "A:AZ";

if (!SHEET_ID) {
  throw new Error("Falta SHEET_ID en el .env");
}

// Cliente de Sheets propio para esta hoja, sin depender de WORKSHEET_NAME del entorno.
async function getSheetsClientForPlan() {
  const auth = getSheetsAuth();
  const authClient = await auth.getClient();
  return google.sheets({ version: "v4", auth: authClient });
}

async function readPlanRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${PLAN_WORKSHEET}!${SHEET_RANGE}`
  });
  return res.data.values || [];
}

async function updatePlanCells(sheets, updates) {
  if (!updates.length) return;

  const data = updates.map((item) => ({
    range: `${PLAN_WORKSHEET}!${colToLetter(item.col)}${item.row}`,
    values: [[item.value ?? ""]]
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data
    }
  });
}

const PLANS = [
  {
    carousel_id: "car_miercoles_existencial",
    ids: [350, 351, 352, 353, 354, 355, 356],
    caption: `El miércoles también cuenta.`,
    hashtags: "#miercoles #vidaadulta #humor #colombia #frases #parati #real #viral"
  },
  {
    carousel_id: "car_relaciones_tarde",
    ids: [357, 358, 359, 360, 361, 362, 363],
    caption: `Uno aprende… pero tarde.`,
    hashtags: "#tusa #relaciones #amorpropio #colombia #frases #parati #real #sentimientos"
  }
];

async function main() {
  console.log(`Aplicando plan sobre hoja: "${PLAN_WORKSHEET}"`);

  const sheets = await getSheetsClientForPlan();
  const rows = await readPlanRows(sheets);

  if (rows.length < 2) {
    console.log(`No hay datos en "${PLAN_WORKSHEET}".`);
    return;
  }

  const headers = rows[0];
  const headerMap = buildHeaderMap(headers);

  requireHeaders(headerMap, [
    "row_id",
    "updated_at",
    "post_tipo",
    "carousel_id",
    "carousel_order",
    "carousel_caption",
    "hashtags",
    "estado_general",
    "estado_render",
    "estado_upload",
    "estado_publish",
    "lock_status",
    "error_step",
    "error_message"
  ]);

  const rowById = new Map();

  for (let i = 1; i < rows.length; i++) {
    const rowId = getCellValue(rows[i], headerMap, "row_id");
    if (rowId) {
      rowById.set(String(rowId).trim(), {
        rowNumber: i + 1,
        values: rows[i]
      });
    }
  }

  const updates = [];
  const now = nowIsoLocal();

  for (const plan of PLANS) {
    console.log(`Aplicando ${plan.carousel_id}...`);

    plan.ids.forEach((id, index) => {
      const item = rowById.get(String(id));

      if (!item) {
        console.warn(`No encontré row_id ${id} para ${plan.carousel_id}`);
        return;
      }

      updates.push(
        { row: item.rowNumber, col: headerMap["post_tipo"] + 1, value: "carousel" },
        { row: item.rowNumber, col: headerMap["carousel_id"] + 1, value: plan.carousel_id },
        { row: item.rowNumber, col: headerMap["carousel_order"] + 1, value: index + 1 },
        { row: item.rowNumber, col: headerMap["carousel_caption"] + 1, value: plan.caption },
        { row: item.rowNumber, col: headerMap["hashtags"] + 1, value: plan.hashtags },
        { row: item.rowNumber, col: headerMap["estado_general"] + 1, value: "pending" },
        { row: item.rowNumber, col: headerMap["estado_render"] + 1, value: "pending" },
        { row: item.rowNumber, col: headerMap["estado_upload"] + 1, value: "pending" },
        { row: item.rowNumber, col: headerMap["estado_publish"] + 1, value: "pending" },
        { row: item.rowNumber, col: headerMap["lock_status"] + 1, value: "free" },
        { row: item.rowNumber, col: headerMap["error_step"] + 1, value: "" },
        { row: item.rowNumber, col: headerMap["error_message"] + 1, value: "" },
        { row: item.rowNumber, col: headerMap["updated_at"] + 1, value: now }
      );
    });
  }

  if (!updates.length) {
    console.log("No hay nada para actualizar.");
    return;
  }

  await updatePlanCells(sheets, updates);

  console.log("Listo.");
  console.log(`Celdas actualizadas: ${updates.length}`);
  console.log(`Carruseles procesados: ${PLANS.length}`);
}

main().catch((error) => {
  console.error("Error aplicando plan de carruseles:");
  console.error(error);
  process.exit(1);
});