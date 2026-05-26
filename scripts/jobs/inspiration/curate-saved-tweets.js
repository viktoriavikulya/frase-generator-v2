/**
 * @deprecated — Analizador offline de frases. NO forma parte del flujo manual.
 *
 * Este script evalúa un archivo .txt localmente y genera CSVs con scoring
 * (quality_score, risk_score, recommendation). Es una herramienta de referencia,
 * NO escribe al Sheet, NO asigna decision_editorial, NO afecta archivo_x.
 *
 * FLUJO ACTUAL (100% manual):
 *   1. Importar frases crudas al Sheet:
 *        npm run import:saved-tweets
 *   2. Curar frase por frase en la interfaz web:
 *        npm run curate:archivo-x  →  http://localhost:5177
 *   3. Generar plan de carruseles (solo frases con decision_editorial=aprobada):
 *        npm run build:carousel-plan
 *
 * Si quieres usar este analizador como referencia personal (no para el pipeline):
 *   npm run analyze:phrases-offline -- data/tweets-guardados-x.txt
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_OUT_DIR = path.join(ROOT, "output");
const { DEFAULT_GROUP, TAXONOMY, getTaxonomyMatch } = require("./taxonomy");
const ACTIVE_THEME_PATTERNS = TAXONOMY.map(({ name, pattern }) => [name, pattern]);

const THEME_PATTERNS = [
  ["Ex", /\b(mi ex|tu ex|su ex|el ex|la ex|un ex|una ex|exnovi[ao]|ex pareja|expareja|ex crush|ex casi algo)\b/],
  ["Vínculos confusos", /\b(casi algo|situationship|ghosting|ghoste\w*|me ghoste\w*|love bombing|lovebombing|contacto 0|contacto cero|se[nñ]ales mixtas|mixed signals|no me escribe|no me habla|me escribe|me responde|me deja en visto|en visto|migaj\w*|intermitente|aparece|desaparece|no sabe lo que quiere|no sabes lo que quieres|cuando me dice|te diria|te diría|me ilusion\w*)\b/],
  ["Desamor y tusa", /\b(tusa|desamor|duelo|extra[nñ]\w*|lo que extranas|lo que extrañas|duele|dol[io]\w*|dolor|romp\w* el corazon|corazon roto|llor\w*|despedida|perd[ií]|perderte|soltar|superar|me dolio|me dolió|me rompi|me romp[ií]|partida|ausencia|no nos perdimos|idealiz\w*)\b/],
  ["Sexo y cuerpo", /\b(sexo|coger|cog[ei]\w*|qliar|culiar|follar|chinga\w*|calenturient\w*|desnud\w*|cuca|culo|tetas|bolas|calzones|ropa puesta|me quito la ropa|sext\w*|cuerpo|cara|carita|carota|fisicamente|físicamente|tatuajes?|vape|culo|pelo[s]? de la cuca)\b/],
  ["Coqueteo y deseo", /\b(coquet\w*|flirte\w*|ligue|crush|cita|beso|besar|arrunch\w*|deseo|cachond\w*|ganas de verte|ganas de vernos|ganas de besarte|me gusta|gustas?|atracci[oó]n|conquist\w*|pretendient\w*|vernos|nos vemos|te quiero cerca|me interesas|quitarme la duda|quiero que me vivas|me vivas|me tengas que vivir|me experimentes|experimentes)\b/],
  ["Hombres", /\b(hombres?|manes?|man\b|el bobo|un feo|feo hombre|heterosexual|p[eé]talo|caballer\w*|novio\b|cachorro|papi|se[nñ]or|ingeniero|m[eé]dico)\b/],
  ["Dinámica de pareja", /\b(pareja|relaci[oó]n|novi[ao]s?|vincul\w*|reciprocidad|responsabilidad afectiva|celos|celosa|celoso|red flags?|red flag|t[oó]xic\w*|cacho|cachos|infiel|perdonar|perd[oó]n|novia|novio|permiso|trato|tratar|resuelva|resuelve|princess treatment|amor propio)\b/],
  ["Amor romántico", /\b(amor romantico|amor romántico|amor\b|amar|enamor\w*|ilusion\w*|romantic\w*|idealiz\w*|querer amor|quiero enamorarme|me quiero enamorar|corazon|corazón|sentimiento|potencial|alma gemela|persona correcta|persona indicada|me gusta cuando|no encontre las palabras|te traje musica|te traigo musica|te traje canciones|te dedique musica)\b/],
  ["Actitud y autoestima", /\b(orgullo|estandares|estándares|autoestima|dignidad|limites|límites|prioridad|opcion|opción|independencia|relajad[ao]|duena de la pinata|dueno de la pinata|pelea por los caramelos|nunca pelea|no toler\w*|no me confundas|no me busques|no te busco|no me debes|no me pidas|me dio flojera|me da flojera|no respondo|no contesto|contestona|vulgaridad|callada|consejos?|alej\w*|no hay necesidad de forzar|no me haces falta|me haces ruido|me ubico mejor)\b/],
  ["Salud mental", /\b(salud mental|ansiedad|depresi[oó]n|terapia|psicolog\w*|traumas?|existencial|vacio|vacío|desmorona|estr[eé]s|estresad\w*|agotad\w*|cansancio|cansad\w*|domingo|lunes|miercoles|miércoles|semana|dormir|procrastin\w*|adultez|vida adulta|fluoxetina|clonazepam|tca|duelo)\b/],
  ["Universidad", /\b(universidad|universitari\w*|facultad|semestre|parcial(?:es)?|profe|profesor\w*|clase|estudi\w*|carrera|uni\b|la u\b|syllabus|materia|apuntes|examen(?:es)?|matricula|matrícula)\b/],
  ["Plata y trabajo", /\b(plata|dinero|billete|sueldo|salario|gast\w*|taca[nñ]o|tarjeta|credito|crédito|compr\w*|pagar|cobrar|cobrame|cóbrame|qr|efectivo|quincena|deuda|trabaj\w*|chamb\w*|jefe|oficina|excel|entrevista|laboral|empleo|camello|contrato|prestacion de servicios|prestación de servicios|trabajador)\b/],
  ["Autorretrato y mood", /\b(yo\b|a mi\b|a mí\b|me siento|me senti|me sentí|amanec[ií]|estoy|soy|mi momento|mi version|mi versión|mi personalidad|mi defensa|mis contradicciones|yo si|yo sí|me pasa|me gusta manejar|ando|no se socializar|no sé socializar|estoy bien|soy un 10|hacerme dano|me hicieron dano|he sobrevivido|sobreviv[ií]\w*|todavia no puedo hablar|todavia no puedo contar|no puedo hablar|no puedo contar|de lo que todavia no puedo)\b/],
  ["Humor y Colombia", /\b(bogota|bogotá|colombia|transmi|transmilenio|sitp|chapinero|tinto|trancon|trancón|pico y placa|bogotano|bogotana|medellin|medellín|parcero|nea|mor|mano|chimba|hpta|gonorrea|verga|mierda|pta|chisme|whatsapp|instagram|chatgpt|ia\b|normalicen|amigos|grupo|familia|gym|rumba|podcast|tiktok|close friends|\bcf\b|historia|like|la gente|uno\b|nadie\b|todo el mundo)\b/]
];

const STYLE_PATTERNS = [
  /\bno es que\b/,
  /\bno soy\b/,
  /\bno me\b/,
  /\bnormalicemos\b/,
  /\bnormalicen\b/,
  /\bustedes?\b/,
  /\bmor\b/,
  /\bamor\b/,
  /\bparcero\b/,
  /\bmano\b/,
  /\bnea\b/,
  /\bhpta\b/,
  /\bpta\b/,
  /\bmierda\b/,
  /\bverga\b/,
  /\bchimba\b/,
  /\bgonorrea\b/,
  /\bme da risa\b/,
  /\bque pereza\b/,
  /\by se nota\b/,
  /\bpara mi\b/,
  /\bni idea\b/,
  /\bme gusta\b/,
  /\bcachond\w*\b/,
  /\bte traje musica\b/,
  /\bquiero que me vivas\b/,
  /\brelajad[ao]\b/,
  /\bduena de la pinata\b/,
  /\bla urgencia\b/,
  /\ba colombia la esta matando\b/,
  /\bse rasuran\b/,
  /\bminimo dame\b/,
  /\bcarta de recomendacion\b/
];

const PUNCHLINE_PATTERNS = [
  /\bpero\b/,
  /\bporque\b/,
  /\bsi\b.+\bentonces\b/,
  /\bsi supieran\b/,
  /\bno\b.+\bes que\b/,
  /\bno es\b.+\bes\b/,
  /\bcomo si\b/,
  /\bpara alguien\b/,
  /\blo que extranas\b/,
  /\bpara que\b/,
  /\bde todas formas\b/,
  /\bnunca pelea\b/,
  /\bte traje musica\b/,
  /\bquiero que me vivas\b/,
  /\bse nota\b/,
  /\bfin\b/,
  /[?:;]/,
  /\.{3}/
];

const SEASONAL_RULES = [
  { seasonality: "seasonal", window: "Feb 14", pattern: /\b(san valentin|enamorados|dia de amor|dia del amor)\b/ },
  { seasonality: "seasonal", window: "May 1", pattern: /\b(dia del trabajador|trabajador|primero de mayo|1ro de mayo)\b/ },
  { seasonality: "seasonal", window: "Halloween / Oct 31", pattern: /\b(halloween|disfraz|brujas)\b/ },
  { seasonality: "seasonal", window: "Navidad / Dec", pattern: /\b(navidad|diciembre|ano nuevo|fin de ano)\b/ },
  { seasonality: "seasonal", window: "Academic cycle", pattern: /\b(parcial|finales|semestre|matricula|primer dia de clase)\b/ },
  { seasonality: "seasonal_event", window: "Event window", pattern: /\b(baum|burger master|mundial|copa america|festival|concierto)\b/ }
];

const EXPIRED_PATTERNS = [
  /\b(ayer|antier|anoche|hoy exactamente|esta semana|este fin de semana)\b/,
  /\b(2020|2021|2022|2023|2024|2025)\b/,
  /\b(elecciones|candidato|presidente|alcalde|congreso|psoe|vox|trump|milei|petro|uribe|fecode)\b/,
  /\b(eurovision|el papa|papa francisco|papafest|opus dei|fetterman|sinema|zapatero)\b/
];

const RISK_PATTERNS = [
  { score: 9, reason: "politics/current-event", pattern: /\b(elecciones|presidente|gobierno|psoe|vox|trump|milei|petro|uribe|congreso|politic[ao])\b/ },
  { score: 8, reason: "identity-sensitive", pattern: /\b(trans|raza|negro|indigena|marica|gay|lesbiana|discapacitad[ao])\b/ },
  { score: 7, reason: "mental-health-heavy", pattern: /\b(suicid|autolesion|trastorno|tca|depresion severa)\b/ },
  { score: 6, reason: "explicit-sexual", pattern: /\b(cuca|polla|qliar|culiar|follar|chinga|sexo|coger)\b/ },
  { score: 5, reason: "very-vulgar", pattern: /\b(hpta|gonorrea|verga|mierda|pta)\b/ }
];

function usage() {
  console.log("Uso:");
  console.log("  npm run analyze:phrases-offline -- ruta/al/archivo.txt");
  console.log("");
  console.log("Opciones:");
  console.log("  --out ruta/salida.csv      Ruta del CSV de salida");
  console.log("  --one-per-line             Fuerza una frase por linea");
  console.log("  --keep-order               No ordenar por quality_score");
  console.log("");
  console.log("NOTA: Este script es solo para análisis offline.");
  console.log("      NO escribe al Sheet ni afecta decision_editorial.");
}

function parseArgs(argv) {
  const args = { input: "", out: "", onePerLine: false, keepOrder: false };

  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === "--out") {
      args.out = argv[++i] || "";
    } else if (item === "--one-per-line") {
      args.onePerLine = true;
    } else if (item === "--keep-order") {
      args.keepOrder = true;
    } else if (!args.input) {
      args.input = item;
    }
  }

  return args;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripEntryNoise(value) {
  return normalizeText(value)
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/\S+$/gim, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForScore(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function splitEntries(content, onePerLine) {
  const normalized = normalizeText(content);
  const blocks = normalized.split(/\n{2,}/).map(stripEntryNoise).filter(Boolean);

  if (!onePerLine && blocks.length >= 10) {
    return blocks;
  }

  return normalized.split("\n").map(stripEntryNoise).filter(Boolean);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function countMatches(text, patterns) {
  return patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
}

function getTheme(scoredText) {
  return getTaxonomyMatch(scoredText)?.name || "other";
}

function getSeasonality(scoredText) {
  for (const rule of SEASONAL_RULES) {
    if (rule.pattern.test(scoredText)) {
      return { seasonality: rule.seasonality, publishWindow: rule.window };
    }
  }

  if (EXPIRED_PATTERNS.some(pattern => pattern.test(scoredText))) {
    return { seasonality: "expired_or_contextual", publishWindow: "" };
  }

  return { seasonality: "evergreen", publishWindow: "" };
}

function getRisk(scoredText) {
  let riskScore = 0;
  const reasons = [];

  for (const item of RISK_PATTERNS) {
    if (item.pattern.test(scoredText)) {
      riskScore = Math.max(riskScore, item.score);
      reasons.push(item.reason);
    }
  }

  return { riskScore, riskReasons: reasons };
}

function scoreTweet(text, index) {
  const sourceText = stripEntryNoise(text);
  const scoredText = normalizeForScore(sourceText);
  const words = scoredText ? scoredText.split(" ").length : 0;
  const charCount = sourceText.length;
  const themeHits = ACTIVE_THEME_PATTERNS.filter(([, pattern]) => pattern.test(scoredText)).length;
  const styleHits = countMatches(scoredText, STYLE_PATTERNS);
  const punchlineHits = countMatches(scoredText, PUNCHLINE_PATTERNS);
  const voiceSignalHits = styleHits + punchlineHits;
  const originalTheme = getTheme(scoredText);
  let theme = originalTheme;
  if (theme === "other") {
    theme = DEFAULT_GROUP;
  }
  const { seasonality, publishWindow } = getSeasonality(scoredText);
  const { riskScore, riskReasons } = getRisk(scoredText);
  const expired = seasonality === "expired_or_contextual";

  const lengthScore = charCount >= 30 && charCount <= 180 ? 10 : charCount <= 240 ? 7 : 3;
  const monaFitScore = clamp(themeHits * 2 + styleHits + lengthScore / 3, 0, 10);
  const punchlineScore = clamp(punchlineHits * 2 + (/[!?]/.test(sourceText) ? 1 : 0), 0, 10);
  const freshnessScore = expired ? 2 : seasonality === "evergreen" ? 10 : 6;
  const contextPenalty = charCount > 240 ? 12 : words > 34 ? 8 : 0;
  const rewritePotential = clamp(monaFitScore + punchlineScore / 2 - riskScore / 3 - (expired ? 2 : 0), 0, 10);

  let qualityScore = Math.round(
    monaFitScore * 4 +
    punchlineScore * 2 +
    rewritePotential * 1.5 +
    freshnessScore * 2 -
    riskScore * 2.5 -
    contextPenalty
  );
  qualityScore = clamp(qualityScore, 0, 100);

  let recommendation = "reject";
  const weakOtherTheme = originalTheme === "other" && voiceSignalHits < 2;
  const voiceRewriteRescue =
    originalTheme === "other" &&
    theme === DEFAULT_GROUP &&
    punchlineHits >= 2 &&
    riskScore < 5 &&
    qualityScore >= 38;
  const borderlineRewriteRescue =
    qualityScore >= 40 &&
    qualityScore < 45 &&
    riskScore < 5 &&
    !expired &&
    (
      originalTheme !== "other" ||
      voiceSignalHits >= 1
    );

  if (charCount < 18 || weakOtherTheme) {
    recommendation = "reject";
  } else if (riskScore >= 8) {
    recommendation = "risky";
  } else if (seasonality !== "evergreen" && qualityScore >= 40) {
    recommendation = "seasonal";
  } else if (qualityScore >= 65 && riskScore < 6) {
    recommendation = "approved";
  } else if (qualityScore >= 45 || voiceRewriteRescue || borderlineRewriteRescue) {
    recommendation = "rewrite_needed";
  }

  const rescued =
    recommendation !== "reject" &&
    (
      originalTheme === "other" ||
      (voiceRewriteRescue && qualityScore < 45) ||
      borderlineRewriteRescue
    );

  const reasons = [];
  if (theme !== "other") reasons.push(`theme:${theme}`);
  if (styleHits) reasons.push(`voice:${styleHits}`);
  if (punchlineHits) reasons.push(`punch:${punchlineHits}`);
  if (seasonality !== "evergreen") reasons.push(seasonality);
  if (riskReasons.length) reasons.push(`risk:${riskReasons.join("+")}`);
  if (contextPenalty) reasons.push("long/contextual");

  return {
    original_index: index + 1,
    recommendation,
    quality_score: qualityScore,
    mona_fit_score: Math.round(monaFitScore),
    freshness_score: freshnessScore,
    rewrite_potential: Math.round(rewritePotential),
    risk_score: riskScore,
    theme,
    seasonality,
    publish_window: publishWindow,
    reason: reasons.join("; "),
    source_text: sourceText,
    rescued
  };
}

function toCsvValue(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(filePath, rows) {
  const headers = [
    "original_index",
    "recommendation",
    "quality_score",
    "mona_fit_score",
    "freshness_score",
    "rewrite_potential",
    "risk_score",
    "theme",
    "seasonality",
    "publish_window",
    "reason",
    "source_text",
    "rescued"
  ];

  const csv = [
    headers.join(","),
    ...rows.map(row => headers.map(header => toCsvValue(row[header])).join(","))
  ].join("\n");

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${csv}\n`, "utf8");
}

function getDefaultOutputPath(inputPath) {
  const base = path.basename(inputPath, path.extname(inputPath)).replace(/[^a-zA-Z0-9_-]+/g, "_");
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  return path.join(DEFAULT_OUT_DIR, `${base}_curated_${stamp}.csv`);
}

function getReviewOutputPath(outPath) {
  const ext = path.extname(outPath) || ".csv";
  return path.join(path.dirname(outPath), `${path.basename(outPath, ext)}_review${ext}`);
}

function getPriorityOutputPath(outPath) {
  const ext = path.extname(outPath) || ".csv";
  return path.join(path.dirname(outPath), `${path.basename(outPath, ext)}_priority${ext}`);
}

function summarize(rows) {
  const counts = {};
  for (const row of rows) {
    counts[row.recommendation] = (counts[row.recommendation] || 0) + 1;
  }
  return counts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.input) {
    usage();
    process.exit(1);
  }

  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`No existe el archivo: ${inputPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, "utf8");
  const entries = splitEntries(raw, args.onePerLine);
  const seen = new Set();
  const scored = [];

  entries.forEach((entry, index) => {
    const key = normalizeForScore(entry);
    if (!key || seen.has(key)) return;
    seen.add(key);
    scored.push(scoreTweet(entry, index));
  });

  const rows = args.keepOrder
    ? scored
    : scored.sort((a, b) => b.quality_score - a.quality_score || a.original_index - b.original_index);

  const outPath = args.out ? path.resolve(args.out) : getDefaultOutputPath(inputPath);
  writeCsv(outPath, rows);

  const reviewRows = rows.filter(row => row.recommendation !== "reject");
  const reviewPath = getReviewOutputPath(outPath);
  writeCsv(reviewPath, reviewRows);

  const priorityRows = rows.filter(row =>
    row.recommendation === "approved" ||
    row.recommendation === "seasonal" ||
    (row.recommendation === "rewrite_needed" && row.quality_score >= 55)
  );
  const priorityPath = getPriorityOutputPath(outPath);
  writeCsv(priorityPath, priorityRows);

  const counts = summarize(rows);
  console.log(`Tweets leidos: ${entries.length}`);
  console.log(`Unicos evaluados: ${rows.length}`);
  console.log(`Salida: ${outPath}`);
  console.log(`Revision: ${reviewPath}`);
  console.log(`Prioridad: ${priorityPath}`);
  console.log(`Para revisar: ${reviewRows.length}`);
  console.log(`Prioridad editorial: ${priorityRows.length}`);
  console.log(`Resumen: ${JSON.stringify(counts)}`);
  console.log("");
  console.log("Top 10:");
  for (const row of rows.slice(0, 10)) {
    console.log(`[${row.quality_score}] ${row.recommendation} / ${row.theme}: ${row.source_text.slice(0, 140)}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  splitEntries,
  scoreTweet,
  normalizeForScore,
  summarize
};