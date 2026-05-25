require("dotenv").config();

const { getSheetsClient, buildHeaderMap, getCellValue } = require("../../core/sheets");
const { colToLetter, nowIsoLocal } = require("../../utils/common");
const { logger } = require("../../utils/logger");

const SHEET_ID = process.env.SHEET_ID;
const WORKSHEET_NAME = process.env.INSPIRATION_WORKSHEET_NAME || "inspiracion";
const SOURCE_MODE = (process.env.INSPIRATION_SOURCE || "auto").toLowerCase();
const QUALITY_MODE = (process.env.INSPIRATION_QUALITY_MODE || "viral").toLowerCase();
const DEFAULT_LIMIT_PER_QUERY = QUALITY_MODE === "explore" ? 25 : 100;
const DEFAULT_MIN_LIKES = QUALITY_MODE === "explore" ? 5 : 20;
const DEFAULT_MIN_SCORE = QUALITY_MODE === "explore" ? 8 : 30;
const LIMIT_PER_QUERY = clampNumber(Number(process.env.INSPIRATION_LIMIT_PER_QUERY || DEFAULT_LIMIT_PER_QUERY), 10, 100);
const TOTAL_LIMIT = clampNumber(Number(process.env.INSPIRATION_TOTAL_LIMIT || 50), 1, 500);
const MIN_LIKES = Number(process.env.INSPIRATION_MIN_LIKES || DEFAULT_MIN_LIKES);
const MIN_SCORE = Number(process.env.INSPIRATION_MIN_SCORE || DEFAULT_MIN_SCORE);
const MIN_TEXT_LENGTH = clampNumber(Number(process.env.INSPIRATION_MIN_TEXT_LENGTH || 25), 5, 500);
const MAX_TEXT_LENGTH = clampNumber(Number(process.env.INSPIRATION_MAX_TEXT_LENGTH || 150), 40, 500);
const MAX_WORDS = clampNumber(Number(process.env.INSPIRATION_MAX_WORDS || 26), 8, 120);
const DRY_RUN = ["1", "true", "yes"].includes(String(process.env.INSPIRATION_DRY_RUN || "").toLowerCase());
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN || "";
const BLUESKY_IDENTIFIER = process.env.BLUESKY_IDENTIFIER || process.env.BSKY_IDENTIFIER || "";
const BLUESKY_APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD || process.env.BSKY_APP_PASSWORD || "";
const BLUESKY_SERVICE_URL = process.env.BLUESKY_SERVICE_URL || "https://bsky.social";
const INSPIRATION_USER_AGENT = process.env.INSPIRATION_USER_AGENT || "frase-generator-v2/1.0";

let xDisabledForRun = false;
let blueskySessionPromise = null;

const DEFAULT_QUERIES = [
  "mi ex",
  "casi algo",
  "red flag pareja",
  "hombres sin plata",
  "los hombres mienten",
  "hombres red flag",
  "relacion toxica",
  "ghosting",
  "no me escribe",
  "no era amor",
  "soltera",
  "mujeres intensas",
  "me enamore",
  "love bombing",
  "me ilusiono",
  "plata amor",
  "jefe WhatsApp",
  "oficina Excel",
  "chambear",
  "universidad semestre",
  "universidad parcial",
  "Bogota trancon",
  "Bogota frio",
  "TransMilenio",
  "Colombia WhatsApp",
  "vida adulta",
  "salud mental",
  "chisme"
];

const SPANISH_MARKERS = new Set([
  "a", "al", "algo", "como", "con", "cuando", "de", "del", "el", "ella", "en", "era", "es",
  "eso", "estoy", "hay", "la", "las", "lo", "los", "mas", "me", "mi", "mis", "muy", "no",
  "para", "pero", "por", "porque", "que", "se", "si", "sin", "su", "te", "todo", "una",
  "un", "ya", "yo"
]);

const SAFE_TITLECASE_WORDS = new Set([
  "Algo", "Aunque", "Cuando", "De", "El", "Ella", "En", "Es", "Este", "Esto", "Hay", "Hoy",
  "La", "Las", "Lo", "Los", "Me", "Mi", "No", "Para", "Pero", "Porque", "Pues", "Que", "Se",
  "Si", "Sin", "Solo", "Un", "Una", "Viernes", "Ya", "Yo"
]);

const REJECT_PATTERNS = [
  { reason: "link", pattern: /https?:\/\/|www\.|youtu\.be|youtube\.com/i },
  { reason: "thread_or_list", pattern: /\b\d+\)|\b\d+\./ },
  { reason: "mention_or_hashtag", pattern: /(^|\s)[@#][\p{L}\p{N}_-]{2,}/u },
  { reason: "quoted_text", pattern: /["“”]/ },
  { reason: "article_or_news", pattern: /\b(esta es su historia|receta|documento oficial|evidencia apunta|segun|aqui|noticia|editorial|michelin|hace veinte años|plaza|foto|libro|d[ií]a de la madre)\b/i },
  { reason: "politics_or_news", pattern: /\b(psoe|vox|podemos|sumar|izquierda|derecha|gobierno|congreso|elecciones|voto|votantes|politic[oa]s?|andalu[cz]ia|navarra|opus dei|zapatero|fetterman|sinema|trump|milei|papa|guardiola|fondos buitre|renovables|cambio clim[aá]tico|climatico|clima|eurovisi[oó]n|eurovision)\b/i },
  { reason: "fandom_or_context", pattern: /\b(ahsoka|thrawn|rebels|fans|serie|temporada|actor|actriz|pelicula|dementor)\b/i },
  { reason: "medical_or_science", pattern: /\b(inflamacion|cronica|quimic[ao]s?|cerebral|inmunitario|conducta alimentaria|nutrientes|calorias|saciedad|tca)\b/i },
  { reason: "food_or_lifestyle", pattern: /\b(cocinar|comida|alimentos?|restaurante|receta|calorias|nutrientes)\b/i },
  { reason: "event_or_party", pattern: /\b(despedida de soltera|murder party|victoriana|hotel|té|customizado|algo rojo)\b/i },
  { reason: "generic_self_help", pattern: /\b(pr[oó]jimo|dolor del otro|date valor|qui[eé]rete a ti|san valent[ií]n|amor propio de)\b/i },
  { reason: "random_context", pattern: /\b(mandarina|bluesky funciona|otoño|sin niños|every breath|20 de abril|canci[oó]n t[oó]xica)\b/i },
  { reason: "sexual_or_vulgar", pattern: /\b(foll[aá]r?|follan|chinga|chingar|culiar|polla)\b/i },
  { reason: "sensitive_context", pattern: /\b(trans|medias)\b/i },
  { reason: "too_specific_context", pattern: /\b(al m[ií]o tambi[eé]n|se me ha acercado|campeona reina|del libro|otro 😂|rauda y veloz|qu[eé] cojones tengo yo|os cont[eé]|ch[aá]chara|crush laboral|mutual|gorrito)\b/i }
];

const STRONG_MONA_TOPIC_PATTERNS = [
  /\bdesamor\b/i,
  /\bmi ex\b/i,
  /\bex\b/i,
  /\bcasi algo\b/i,
  /\bpareja\b/i,
  /\bnovi[oa]s?\b/i,
  /\bsolter[ao]s?\b/i,
  /\bcelos\b/i,
  /\brelaci[oó]n\b/i,
  /\benamor/i,
  /\bilusion/i,
  /\bghosting\b/i,
  /\bghoste/i,
  /\bligue\b/i,
  /\bcrush\b/i,
  /\blove bombing\b/i,
  /\bme escribe\b/i,
  /\bno me escribe\b/i,
  /\bwhatsapp\b/i,
  /\bmensaje[s]?\b/i,
  /\bconociendo\b/i,
  /\bcita[s]?\b/i,
  /\brom[aá]ntic[ao]\b/i,
  /\bcoraz[oó]n\b/i,
  /\bme gusta\b/i
];

const RELATION_CONTEXT_PATTERNS = [
  /\bex\b/i,
  /\bnovi[oa]s?\b/i,
  /\bpareja\b/i,
  /\brelaci[oó]n\b/i,
  /\bconociendo\b/i,
  /\bcita[s]?\b/i,
  /\bligue\b/i,
  /\bcrush\b/i,
  /\bwhatsapp\b/i,
  /\bmensaje[s]?\b/i,
  /\bghost/i,
  /\blove bombing\b/i
];

const BRAND_TOPIC_PATTERNS = [
  /\bhombres?\b/i,
  /\bmujeres?\b/i,
  /\bintens[ao]s?\b/i,
  /\bplata\b/i,
  /\bgast/i,
  /\btacan[ao]\b/i,
  /\bchamb/i,
  /\bjefe\b/i,
  /\boficina\b/i,
  /\bexcel\b/i,
  /\bfacultad\b/i,
  /\bsemestre\b/i,
  /\bparcial(?:es)?\b/i,
  /\bprofe\b/i,
  /\btransmi(?:lenio)?\b/i,
  /\bsitp\b/i,
  /\bchapinero\b/i,
  /\btinto\b/i,
  /\bchisme\b/i,
  /\bvida adulta\b/i,
  /\bcansancio\b/i,
  /\bprocrastin/i,
  /\bsalud mental\b/i,
  /\bchat ?gpt\b/i,
  /\bnormalicen\b/i,
  /\bbogota\b.*\b(frio|trancon|tinto|chapinero|sitp|transmi)\b/i,
  /\bcolombia\b.*\b(whatsapp|podcast|llamadera|madrugadera|concierto|arrunche)\b/i
];

const BRAND_VOICE_PATTERNS = [
  /\bme\b/i,
  /\bmi\b/i,
  /\byo\b/i,
  /\buno\b/i,
  /\bte\b/i,
  /\busted(?:es)?\b/i,
  /\bamor\b/i,
  /\bmor\b/i,
  /\bparcero\b/i,
  /\bflac[ao]\b/i,
  /\bmanes?\b/i,
  /\bviejas?\b/i,
  /\bnormalicen\b/i,
  /\bwhatsapp\b/i,
  /\bchat ?gpt\b/i
];

const HEADERS = [
  "inspiration_id",
  "source_platform",
  "source_id",
  "source_url",
  "source_author",
  "source_text",
  "like_count",
  "reply_count",
  "repost_count",
  "quote_count",
  "view_count",
  "score",
  "query",
  "captured_at",
  "status",
  "mona_version",
  "notes"
];

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function getQueries() {
  const raw = process.env.INSPIRATION_QUERIES || "";
  const parsed = raw
    .split("||")
    .map(q => q.trim())
    .filter(Boolean);

  return parsed.length ? parsed : DEFAULT_QUERIES;
}

function normalizeText(value) {
  return (value || "")
    .toString()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForDedupe(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildScore({ likeCount, replyCount, repostCount, quoteCount, viewCount }) {
  return Math.round(
    Number(likeCount || 0) +
    Number(replyCount || 0) * 2 +
    Number(repostCount || 0) * 3 +
    Number(quoteCount || 0) * 3 +
    Number(viewCount || 0) * 0.001
  );
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

function countSpanishMarkers(text) {
  return normalizeForDedupe(text)
    .split(" ")
    .filter(word => SPANISH_MARKERS.has(word)).length;
}

function countTitlecaseWords(text) {
  const words = text.match(/\b[\p{Lu}ÁÉÍÓÚÑ][\p{Ll}áéíóúñ]{3,}\b/gu) || [];
  return words.filter(word => !SAFE_TITLECASE_WORDS.has(word)).length;
}

function countWords(text) {
  return normalizeForDedupe(text)
    .split(" ")
    .filter(Boolean).length;
}

function hasMonaTopic(text) {
  const normalized = normalizeForDedupe(text);
  const searchable = `${text} ${normalized}`;

  if (STRONG_MONA_TOPIC_PATTERNS.some(pattern => pattern.test(searchable))) return true;

  const hasRelationshipContext = RELATION_CONTEXT_PATTERNS.some(pattern => pattern.test(searchable));
  if (/\bred flags?\b/i.test(searchable) && hasRelationshipContext) return true;
  if (/\bt[oó]xic[ao]s?\b/i.test(searchable) && hasRelationshipContext) return true;

  const hasBrandTopic = BRAND_TOPIC_PATTERNS.some(pattern => pattern.test(searchable));
  const hasBrandVoice = BRAND_VOICE_PATTERNS.some(pattern => pattern.test(searchable));
  if (hasBrandTopic && hasBrandVoice) return true;

  return false;
}

function getCandidateRejectReason(candidate) {
  const text = normalizeText(candidate.sourceText);
  const rawText = candidate.rawText || candidate.sourceText || "";
  const combinedText = `${rawText} ${text}`;

  if (text.length < MIN_TEXT_LENGTH) return "too_short";
  if (text.length > MAX_TEXT_LENGTH) return "too_long";
  if (countWords(text) > MAX_WORDS) return "too_many_words";
  if (Number(candidate.likeCount || 0) < MIN_LIKES) return "not_enough_likes";
  if (Number(candidate.score || 0) < MIN_SCORE) return "not_enough_score";

  for (const { reason, pattern } of REJECT_PATTERNS) {
    if (pattern.test(combinedText)) return reason;
  }

  if (!hasMonaTopic(text)) return "not_mona_topic";
  if (countSpanishMarkers(text) < 2 && !/[áéíóúñ¿¡]/i.test(text)) return "not_spanish_enough";
  if (countMatches(text, /[.!?;:]/g) > 3) return "too_many_sentences";
  if (countMatches(text, /,/g) > 4) return "too_many_commas";
  if (countTitlecaseWords(text) >= 4) return "too_contextual";

  return "";
}

function shouldKeepCandidate(candidate) {
  return !getCandidateRejectReason(candidate);
}

function incrementCount(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

function summarizeHttpBody(body) {
  return (body || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function getHttpErrorDetail(data, body) {
  return data?.error || data?.message || data?.detail || data?.title || summarizeHttpBody(body) || "Sin detalle";
}

async function fetchJson(url, { method = "GET", headers = {}, body: requestBody } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "User-Agent": INSPIRATION_USER_AGENT,
      ...headers
    },
    body: requestBody
  });
  const responseBody = await res.text();

  let data;
  try {
    data = responseBody ? JSON.parse(responseBody) : {};
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${getHttpErrorDetail(data, responseBody)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

function canUseSource(source) {
  if (SOURCE_MODE === "auto") return true;
  return SOURCE_MODE.split(",").map(s => s.trim()).includes(source);
}

async function fetchFromX(query) {
  const url = new URL("https://api.x.com/2/tweets/search/recent");
  url.searchParams.set("query", `${query} lang:es -is:retweet -is:reply -has:links`);
  url.searchParams.set("max_results", String(LIMIT_PER_QUERY));
  url.searchParams.set("sort_order", "relevancy");
  url.searchParams.set("tweet.fields", "created_at,public_metrics,lang,author_id,possibly_sensitive");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username,name,verified,public_metrics");

  const data = await fetchJson(url, {
    headers: {
      Authorization: `Bearer ${X_BEARER_TOKEN}`
    }
  });

  const usersById = new Map((data.includes?.users || []).map(user => [user.id, user]));

  return (data.data || []).map(tweet => {
    const user = usersById.get(tweet.author_id) || {};
    const metrics = tweet.public_metrics || {};
    const username = user.username || tweet.author_id || "";
    const likeCount = Number(metrics.like_count || 0);
    const replyCount = Number(metrics.reply_count || 0);
    const repostCount = Number(metrics.retweet_count || 0);
    const quoteCount = Number(metrics.quote_count || 0);
    const viewCount = Number(metrics.impression_count || 0);
    const rawText = tweet.text || "";

    return {
      sourcePlatform: "x",
      sourceId: tweet.id,
      sourceUrl: username ? `https://x.com/${username}/status/${tweet.id}` : `https://x.com/i/web/status/${tweet.id}`,
      sourceAuthor: username,
      sourceText: normalizeText(rawText),
      rawText,
      likeCount,
      replyCount,
      repostCount,
      quoteCount,
      viewCount,
      score: buildScore({ likeCount, replyCount, repostCount, quoteCount, viewCount }),
      query
    };
  });
}

function getBlueskyPostUrl(post) {
  const handle = post.author?.handle || "";
  const rkey = (post.uri || "").split("/").pop();

  if (!handle || !rkey) return "";

  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

function buildBlueskySearchUrl(baseUrl, query, withTopSort = true) {
  const url = new URL("/xrpc/app.bsky.feed.searchPosts", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(Math.min(LIMIT_PER_QUERY, 100)));
  url.searchParams.set("lang", "es");

  if (withTopSort) {
    url.searchParams.set("sort", "top");
  }

  return url;
}

async function createBlueskySession() {
  if (!BLUESKY_IDENTIFIER || !BLUESKY_APP_PASSWORD) return null;

  const url = new URL("/xrpc/com.atproto.server.createSession", BLUESKY_SERVICE_URL);
  const data = await fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      identifier: BLUESKY_IDENTIFIER,
      password: BLUESKY_APP_PASSWORD
    })
  });

  if (!data?.accessJwt) {
    throw new Error("Bluesky no devolvio accessJwt al crear sesion");
  }

  return data;
}

async function getBlueskySession() {
  if (!blueskySessionPromise) {
    blueskySessionPromise = createBlueskySession();
  }

  return blueskySessionPromise;
}

function getBlueskyPdsUrl(session) {
  const services = session?.didDoc?.service || [];
  const pds = services.find(service =>
    service.id === "#atproto_pds" ||
    service.type === "AtprotoPersonalDataServer" ||
    service.type === "AtprotoPersonalDataServerService"
  );

  return pds?.serviceEndpoint || BLUESKY_SERVICE_URL;
}

async function fetchBlueskySearch(query) {
  const attempts = [];
  const publicHosts = ["https://public.api.bsky.app", "https://api.bsky.app"];

  for (const host of publicHosts) {
    for (const withTopSort of [true, false]) {
      const url = buildBlueskySearchUrl(host, query, withTopSort);

      try {
        return await fetchJson(url);
      } catch (err) {
        attempts.push(`${host}${withTopSort ? " sort=top" : ""}: ${err.message}`);
      }
    }
  }

  const session = await getBlueskySession();

  if (session?.accessJwt) {
    const pdsUrl = getBlueskyPdsUrl(session);

    for (const withTopSort of [true, false]) {
      const url = buildBlueskySearchUrl(pdsUrl, query, withTopSort);

      try {
        return await fetchJson(url, {
          headers: {
            Authorization: `Bearer ${session.accessJwt}`
          }
        });
      } catch (err) {
        attempts.push(`${pdsUrl}${withTopSort ? " sort=top auth" : " auth"}: ${err.message}`);
      }
    }
  }

  const err = new Error(attempts.join(" | "));
  err.status = 403;
  throw err;
}

function mapBlueskyPosts(data, query) {
  return (data.posts || []).map(post => {
    const likeCount = Number(post.likeCount || 0);
    const replyCount = Number(post.replyCount || 0);
    const repostCount = Number(post.repostCount || 0);
    const quoteCount = Number(post.quoteCount || 0);
    const rawText = post.record?.text || "";

    return {
      sourcePlatform: "bluesky",
      sourceId: post.uri || post.cid || "",
      sourceUrl: getBlueskyPostUrl(post),
      sourceAuthor: post.author?.handle || "",
      sourceText: normalizeText(rawText),
      rawText,
      likeCount,
      replyCount,
      repostCount,
      quoteCount,
      viewCount: 0,
      score: buildScore({ likeCount, replyCount, repostCount, quoteCount, viewCount: 0 }),
      query
    };
  });
}

async function fetchFromBluesky(query) {
  const data = await fetchBlueskySearch(query);
  return mapBlueskyPosts(data, query);
}

async function ensureWorksheet(sheets) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: "sheets.properties.title"
  });

  const exists = (meta.data.sheets || []).some(sheet => sheet.properties?.title === WORKSHEET_NAME);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: WORKSHEET_NAME
              }
            }
          }
        ]
      }
    });
    logger.info("Pestaña de inspiración creada", { worksheet: WORKSHEET_NAME });
  }
}

async function readInspirationRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${WORKSHEET_NAME}!A:Z`
  }).catch(err => {
    if (err.code === 400 || err.code === 404) return { data: { values: [] } };
    throw err;
  });

  return res.data.values || [];
}

async function ensureHeaders(sheets, rows) {
  const currentHeaders = rows[0] || [];
  const existing = new Set(currentHeaders.map(h => String(h || "").trim()).filter(Boolean));
  const mergedHeaders = [...currentHeaders.filter(Boolean)];

  for (const header of HEADERS) {
    if (!existing.has(header)) {
      mergedHeaders.push(header);
    }
  }

  if (mergedHeaders.length !== currentHeaders.length || rows.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${WORKSHEET_NAME}!A1:${colToLetter(mergedHeaders.length)}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [mergedHeaders]
      }
    });
    return [mergedHeaders, ...rows.slice(1)];
  }

  return rows;
}

function buildExistingIndexes(rows, headerMap) {
  const sourceKeys = new Set();
  const textKeys = new Set();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const platform = getCellValue(row, headerMap, "source_platform");
    const sourceId = getCellValue(row, headerMap, "source_id");
    const sourceText = getCellValue(row, headerMap, "source_text");

    if (platform && sourceId) {
      sourceKeys.add(`${platform}:${sourceId}`);
    }

    const normalized = normalizeForDedupe(sourceText);
    if (normalized) {
      textKeys.add(normalized);
    }
  }

  return { sourceKeys, textKeys };
}

function candidateToRow(candidate, headerMap, capturedAt) {
  const values = [];
  const set = (field, value) => {
    values[headerMap[field]] = value ?? "";
  };

  set("inspiration_id", `${candidate.sourcePlatform}_${String(candidate.sourceId).replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 80)}`);
  set("source_platform", candidate.sourcePlatform);
  set("source_id", candidate.sourceId);
  set("source_url", candidate.sourceUrl);
  set("source_author", candidate.sourceAuthor);
  set("source_text", candidate.sourceText);
  set("like_count", candidate.likeCount);
  set("reply_count", candidate.replyCount);
  set("repost_count", candidate.repostCount);
  set("quote_count", candidate.quoteCount);
  set("view_count", candidate.viewCount);
  set("score", candidate.score);
  set("query", candidate.query);
  set("captured_at", capturedAt);
  set("status", "new");
  set("mona_version", "");
  set("notes", "");

  return values;
}

async function appendCandidates(sheets, rows, headerMap, candidates) {
  if (!candidates.length) return;

  const capturedAt = nowIsoLocal();
  const values = candidates.map(candidate => candidateToRow(candidate, headerMap, capturedAt));
  const width = Math.max(...values.map(row => row.length), HEADERS.length);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${WORKSHEET_NAME}!A:${colToLetter(width)}`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values
    }
  });
}

async function fetchCandidatesForQuery(query) {
  const results = [];

  if (canUseSource("x") && X_BEARER_TOKEN && !xDisabledForRun) {
    try {
      results.push(...await fetchFromX(query));
    } catch (err) {
      if (err.status === 402) {
        xDisabledForRun = true;
        logger.warn("X respondio sin creditos; se omite X por el resto de esta corrida", { query, error: err.message });
      } else {
        logger.warn("No se pudo consultar X", { query, error: err.message });
      }
    }
  }

  if (canUseSource("bluesky")) {
    try {
      results.push(...await fetchFromBluesky(query));
    } catch (err) {
      logger.warn("No se pudo consultar Bluesky", { query, error: err.message });
    }
  }

  return results;
}

async function main() {
  const log = logger.child({ job: "fetch-inspiration", worksheet: WORKSHEET_NAME });
  const queries = getQueries();

  log.info("Buscando inspiración viral", {
    queries: queries.length,
    sourceMode: SOURCE_MODE,
    qualityMode: QUALITY_MODE,
    minLikes: MIN_LIKES,
    minScore: MIN_SCORE,
    limitPerQuery: LIMIT_PER_QUERY,
    minTextLength: MIN_TEXT_LENGTH,
    maxTextLength: MAX_TEXT_LENGTH,
    maxWords: MAX_WORDS,
    dryRun: DRY_RUN
  });

  if (canUseSource("x") && !X_BEARER_TOKEN) {
    log.warn("X_BEARER_TOKEN no configurado; se omite X y se usan fuentes disponibles.");
  }

  const sheets = await getSheetsClient();

  await ensureWorksheet(sheets);
  let rows = await readInspirationRows(sheets);
  rows = await ensureHeaders(sheets, rows);

  const headerMap = buildHeaderMap(rows[0]);
  const { sourceKeys, textKeys } = buildExistingIndexes(rows, headerMap);

  const allCandidates = [];

  for (const query of queries) {
    const candidates = await fetchCandidatesForQuery(query);
    log.info("Candidatos encontrados", { query, count: candidates.length });
    allCandidates.push(...candidates);
  }

  const selected = [];
  const seenSourceKeys = new Set(sourceKeys);
  const seenTextKeys = new Set(textKeys);
  const rejectedByReason = {};
  let duplicateCount = 0;

  for (const candidate of allCandidates.sort((a, b) => b.score - a.score)) {
    const rejectReason = getCandidateRejectReason(candidate);

    if (rejectReason) {
      incrementCount(rejectedByReason, rejectReason);
      continue;
    }

    const sourceKey = `${candidate.sourcePlatform}:${candidate.sourceId}`;
    const textKey = normalizeForDedupe(candidate.sourceText);

    if (seenSourceKeys.has(sourceKey)) {
      duplicateCount += 1;
      continue;
    }
    if (seenTextKeys.has(textKey)) {
      duplicateCount += 1;
      continue;
    }

    seenSourceKeys.add(sourceKey);
    seenTextKeys.add(textKey);
    selected.push(candidate);

    if (selected.length >= TOTAL_LIMIT) break;
  }

  if (!DRY_RUN) {
    await appendCandidates(sheets, rows, headerMap, selected);
  }

  log.info("Inspiración guardada", {
    fetched: allCandidates.length,
    saved: selected.length,
    skipped: allCandidates.length - selected.length,
    duplicate: duplicateCount,
    rejectedByReason: JSON.stringify(rejectedByReason),
    selectedPreview: DRY_RUN ? JSON.stringify(selected.slice(0, 5).map(candidate => ({
      likes: candidate.likeCount,
      query: candidate.query,
      text: candidate.sourceText.slice(0, 120)
    }))) : "",
    dryRun: DRY_RUN
  });
}

main().catch(err => {
  logger.error("Error buscando inspiración", {}, err);
  process.exit(1);
});
