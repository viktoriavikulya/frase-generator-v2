require("dotenv").config();

// La hoja objetivo se puede pasar como argumento: node apply-single-plan.js "Hoja 11"
// Si no se pasa, usa este valor por defecto.
const PLAN_WORKSHEET = process.argv[2] || "Hoja 11";

const { getSheetsAuth } = require("../../auth/google-auth");
const { google } = require("googleapis");
const {
  buildHeaderMap,
  requireHeaders,
  getCellValue,
  updateCellsBatch
} = require("../../core/sheets");

const { normalizeValue, colToLetter } = require("../../utils/common");
const { nowIsoLocal } = require("../../utils/common");

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

const SINGLES = [

  { id: 12, caption: "El estrés es opcional… la pereza no.", hashtags: "#humor #vida #colombia #frases #parati #real" },

  { id: 15, caption: "Mentir es fácil… sostenerlo no tanto.", hashtags: "#verdad #mentiras #frases #colombia #parati #real" },

  { id: 35, caption: "Hay gente que debería tener restricción de pensamiento.", hashtags: "#humor #colombia #frases #parati #real #sarcasmo" },

  { id: 39, caption: "El estándar no es alto… es lógico.", hashtags: "#amorpropio #relaciones #frases #colombia #parati #real" },

  { id: 65, caption: "Uno dice que va a cambiar… pero tampoco tanto.", hashtags: "#humor #vida #frases #colombia #parati #real" },

  { id: 79, caption: "Hay cosas que simplemente sacan lo peor de uno.", hashtags: "#humor #colombia #frases #parati #real" },

  { id: 90, caption: "El silencio también es una respuesta.", hashtags: "#relaciones #frases #colombia #parati #real #amorpropio" },

  { id: 104, caption: "El trauma también da personalidad, al parecer.", hashtags: "#humor #vida #frases #colombia #parati #real" },

  { id: 116, caption: "A uno lo educaron bien… lo otro es decisión propia.", hashtags: "#actitud #frases #colombia #parati #real" },

  { id: 122, caption: "No todos los ex son malos… pero igual no vuelvo.", hashtags: "#relaciones #tusa #frases #colombia #parati #real" },

  { id: 123, caption: "No es creída… es que no encaja con cualquiera.", hashtags: "#actitud #frases #colombia #parati #real" },

  { id: 125, caption: "Mi cabeza no descansa ni cuando yo sí.", hashtags: "#mente #frases #colombia #parati #real #insomnio" },

  { id: 137, caption: "Las prioridades cambian… y se nota.", hashtags: "#relaciones #vida #frases #colombia #parati #real" },

  { id: 149, caption: "El problema no es la soledad… es el nivel.", hashtags: "#actitud #frases #colombia #parati #real" },

  { id: 152, caption: "Hay modas que simplemente no deberían existir.", hashtags: "#humor #colombia #frases #parati #real" },

  { id: 156, caption: "La vida es un ciclo… y a veces uno duda del trato.", hashtags: "#humor #frases #colombia #parati #real" },

  { id: 158, caption: "La tranquilidad también es una elección.", hashtags: "#vida #frases #colombia #parati #real #paz" },

  { id: 160, caption: "Prioridades modernas… cuestionables.", hashtags: "#humor #frases #colombia #parati #real" },

  { id: 169, caption: "No es perderse… es saber retirarse.", hashtags: "#amorpropio #frases #colombia #parati #real" },

  { id: 178, caption: "Hay historias que no son para uno.", hashtags: "#amor #frases #colombia #parati #real" },

  { id: 191, caption: "El problema no es el pétalo… es el criterio.", hashtags: "#humor #frases #colombia #parati #real" },

  { id: 203, caption: "Uno queriendo hablar bonito… y el mundo en ghosting.", hashtags: "#universidad #relaciones #frases #colombia #parati #real" },

  { id: 205, caption: "La empatía no es para todo el mundo.", hashtags: "#realidad #frases #colombia #parati #real" },

  { id: 206, caption: "Hay decisiones que dicen demasiado de uno.", hashtags: "#humor #relaciones #frases #colombia #parati #real" },

  { id: 210, caption: "La ignorancia también es atrevida.", hashtags: "#humor #frases #colombia #parati #real" },

  { id: 211, caption: "Amor selectivo… distribución democrática.", hashtags: "#humor #frases #colombia #parati #real" },

  { id: 217, caption: "Hay cosas que dejan de gustar… y es sano.", hashtags: "#relaciones #frases #colombia #parati #real" },

  { id: 222, caption: "La privacidad también tiene niveles.", hashtags: "#humor #frases #colombia #parati #real" },

  { id: 226, caption: "Las indirectas evolucionaron.", hashtags: "#redes #relaciones #frases #colombia #parati #real" },

  { id: 228, caption: "Costumbres que no deberían perderse.", hashtags: "#humor #frases #colombia #parati #real" },

  { id: 229, caption: "La edad no siempre trae madurez.", hashtags: "#realidad #frases #colombia #parati #real" },

  { id: 233, caption: "Pensar demasiado también cansa.", hashtags: "#tdah #frases #colombia #parati #real" },

  { id: 237, caption: "Hay horas donde todo pesa más.", hashtags: "#noche #frases #colombia #parati #real" },

  { id: 238, caption: "Consejos financieros modernos.", hashtags: "#humor #colombia #frases #parati #real" },

  { id: 242, caption: "Sanar también tiene sus riesgos.", hashtags: "#vida #frases #colombia #parati #real" },

  { id: 248, caption: "La soledad también tiene rutina.", hashtags: "#vida #frases #colombia #parati #real" },

  { id: 250, caption: "La comunicación también es un arte.", hashtags: "#relaciones #frases #colombia #parati #real" },

  { id: 252, caption: "Cada quien se aferra a lo suyo.", hashtags: "#vida #frases #colombia #parati #real" },

  { id: 256, caption: "Hay decisiones que uno ya tomó hace rato.", hashtags: "#humor #colombia #frases #parati #real" },

  { id: 257, caption: "Las prioridades dicen mucho.", hashtags: "#humor #frases #colombia #parati #real" },

  { id: 259, caption: "La lógica no es común.", hashtags: "#realidad #frases #colombia #parati #real" },

  { id: 264, caption: "A veces el problema no es el otro.", hashtags: "#relaciones #frases #colombia #parati #real" },

  { id: 266, caption: "Hay gente que se toma personal lo ajeno.", hashtags: "#humor #frases #colombia #parati #real" },

  { id: 267, caption: "Rutinas que sostienen la vida.", hashtags: "#vida #frases #colombia #parati #real" },

  { id: 271, caption: "El mínimo esfuerzo también es una elección.", hashtags: "#relaciones #frases #colombia #parati #real" },

  { id: 273, caption: "La vida sigue… con o sin plan.", hashtags: "#humor #frases #colombia #parati #real" },

  { id: 280, caption: "El cuerpo ya no coopera como antes.", hashtags: "#edad #frases #colombia #parati #real" },

  { id: 281, caption: "Hay días que no son para socializar.", hashtags: "#vida #frases #colombia #parati #real" },

  { id: 283, caption: "Pedidos modernos para sobrevivir.", hashtags: "#humor #frases #colombia #parati #real" },

  { id: 285, caption: "El clima también influye en todo.", hashtags: "#vida #frases #colombia #parati #real" },

  { id: 288, caption: "Estrategias modernas de supervivencia.", hashtags: "#gym #humor #frases #colombia #parati #real" },

  { id: 291, caption: "Ojalá la IA también sienta esto.", hashtags: "#ia #humor #frases #colombia #parati #real" },

  { id: 295, caption: "Las tradiciones cambiaron… para peor.", hashtags: "#humor #frases #colombia #parati #real" }

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
    "caption",
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

  for (const single of SINGLES) {
    const item = rowById.get(String(single.id));

    if (!item) {
      console.warn(`No encontré row_id ${single.id} en "${PLAN_WORKSHEET}"`);
      continue;
    }

    updates.push(
      { row: item.rowNumber, col: headerMap["post_tipo"] + 1, value: "single" },
      { row: item.rowNumber, col: headerMap["caption"] + 1, value: single.caption },
      { row: item.rowNumber, col: headerMap["hashtags"] + 1, value: single.hashtags },
      { row: item.rowNumber, col: headerMap["estado_general"] + 1, value: "pending" },
      { row: item.rowNumber, col: headerMap["estado_render"] + 1, value: "pending" },
      { row: item.rowNumber, col: headerMap["estado_upload"] + 1, value: "pending" },
      { row: item.rowNumber, col: headerMap["estado_publish"] + 1, value: "pending" },
      { row: item.rowNumber, col: headerMap["lock_status"] + 1, value: "free" },
      { row: item.rowNumber, col: headerMap["error_step"] + 1, value: "" },
      { row: item.rowNumber, col: headerMap["error_message"] + 1, value: "" },
      { row: item.rowNumber, col: headerMap["updated_at"] + 1, value: now }
    );
  }

  if (!updates.length) {
    console.log("No hay nada para actualizar.");
    return;
  }

  await updatePlanCells(sheets, updates);

  console.log("Listo.");
  console.log(`Singles procesados: ${SINGLES.length}`);
  console.log(`Celdas actualizadas: ${updates.length}`);
}

main().catch((error) => {
  console.error("Error aplicando plan de singles:");
  console.error(error);
  process.exit(1);
});