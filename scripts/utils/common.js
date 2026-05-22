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
 *
 * Usa Intl.DateTimeFormat con timeZoneName: "shortOffset" para obtener el
 * offset real sin ambigüedad, en lugar de comparar timestamps (que fallaba
 * en entornos UTC como GitHub Actions al interpretar localStr como UTC).
 */
function getUtcOffset(timeZone) {
  const now = new Date();

  // Extraemos el offset directamente del formateador — sin new Date(localStr)
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone,
    timeZoneName: "shortOffset"
  });

  // El formato retorna algo como "5/21/2026, GMT-5" o "5/21/2026, GMT+5:30"
  const parts = formatter.formatToParts(now);
  const tzPart = parts.find(p => p.type === "timeZoneName")?.value || "";

  // tzPart puede ser "GMT-5", "GMT+5:30", "GMT+0", etc.
  const match = tzPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);

  if (!match) {
    // Fallback seguro: Bogotá es siempre UTC-5 (sin DST)
    return "-05:00";
  }

  const sign = match[1];
  const hh = String(match[2]).padStart(2, "0");
  const mm = String(match[3] || "0").padStart(2, "0");

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