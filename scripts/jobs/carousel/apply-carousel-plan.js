require("dotenv").config();

process.env.WORKSHEET_NAME = "Hoja 2";

const {
  getSheetsClient,
  buildHeaderMap,
  requireHeaders,
  getCellValue,
  readRows,
  updateCellsBatch
} = require("../../core/sheets");

const { nowIsoLocal } = require("../../utils/common");

const PLANS = [
  {
    carousel_id: "car_reparacion_2026",
    ids: [337, 338, 339, 340, 341, 342, 343, 344, 345, 346],
    caption: `En reparación… sin fecha de entrega.`,
    hashtags: "#sanacion #vidaadulta #humor #colombia #frases #parati #real #viral"
  }
];

async function main() {
  const sheets = await getSheetsClient();
  const rows = await readRows(sheets);

  if (rows.length < 2) {
    console.log("No hay datos en Hoja 2.");
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

  await updateCellsBatch(sheets, updates);

  console.log("Listo.");
  console.log(`Celdas actualizadas: ${updates.length}`);
  console.log(`Carruseles procesados: ${PLANS.length}`);
}

main().catch((error) => {
  console.error("Error aplicando plan de carruseles:");
  console.error(error);
  process.exit(1);
});