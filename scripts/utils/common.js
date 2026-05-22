// Zona horaria del proyecto. Cambiar aquí afecta todas las fechas del pipeline.
const TZ = "America/Bogota";

function normalizeValue(value) {
  return (value || "").toString().trim();
}

/**
 * Retorna la fecha/hora actual como string ISO 8601 en hora local de Colombia
 * (America/Bogota, UTC-5), incluyendo el offset explícito.
 *
 * Ejemplo: "2026-05-21T10:00:00-05:00"
 *
 * El offset explícito garantiza que Date.parse() siga funcionando correctamente
 * donde las fechas se comparan para saber cuál es más reciente.
 *
 * Antes retornaba new Date().toISOString() que siempre da UTC ("...Z"),
 * lo que hacía que las fechas en el sheet mostraran 5 horas de diferencia.
 */
function nowIsoLocal() {
  return new Date().toLocaleString("sv-SE", {
    timeZone: TZ,
    hour12: false
  }).replace(" ", "T") + getUtcOffset(TZ);
}

/**
 * Calcula el offset UTC actual para una zona horaria dada, respetando DST.
 * Retorna string con formato "+HH:MM" o "-HH:MM".
 */
function getUtcOffset(timeZone) {
  const now = new Date();

  // Obtenemos la hora en UTC y en la zona objetivo para calcular la diferencia.
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const localStr = now.toLocaleString("sv-SE", { timeZone, hour12: false });
  const localMs = new Date(localStr).getTime();

  const diffMinutes = Math.round((localMs - utcMs) / 60000);
  const sign = diffMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(diffMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");

  return `${sign}${hh}:${mm}`;
}

function colToLetter(colNumber) {
  let temp = colNumber;
  let letter = "";

  while (temp > 0) {
    const rem = (temp - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    temp = Math.floor((temp - rem - 1) / 26);
  }

  return letter;
}

module.exports = {
  normalizeValue,
  nowIsoLocal,
  colToLetter
};