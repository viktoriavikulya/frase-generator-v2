const { STATUS, GENERAL_STATUS } = require("../core/status");
const { RETRO_PALETTES } = require("../config/retro-palettes");
const { getCellValueSoft } = require("../core/sheets");

const RANDOM_HISTORY_SIZE = 6;
const COLOR_DISTANCE_THRESHOLD = 85;

const PALETTES_IN_CYCLE = RETRO_PALETTES.filter(p => p.inCycle !== false);

const PALETTE_BY_BG = new Map(
  PALETTES_IN_CYCLE.map(p => [p.bg.toLowerCase(), p])
);

function getPaletteIdByBg(bg) {
  const normalizedBg = (bg || "").toLowerCase().trim();
  return PALETTE_BY_BG.get(normalizedBg)?.id || "";
}

function hexToRgb(hex) {
  const normalized = (hex || "").replace("#", "").trim();

  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    return null;
  }

  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  };
}

function colorDistance(bgA, bgB) {
  const a = hexToRgb(bgA);
  const b = hexToRgb(bgB);

  if (!a || !b) return Infinity;

  return Math.sqrt(
    Math.pow(a.r - b.r, 2) +
    Math.pow(a.g - b.g, 2) +
    Math.pow(a.b - b.b, 2)
  );
}

function areSimilarColors(candidateBg, recentBg) {
  const candidate = (candidateBg || "").toLowerCase().trim();
  const recent = (recentBg || "").toLowerCase().trim();

  if (!candidate || !recent) return false;
  if (candidate === recent) return true;

  return colorDistance(candidate, recent) <= COLOR_DISTANCE_THRESHOLD;
}

function getRowTimestamp(row, headerMap, isPublished) {
  const field = isPublished ? "fecha_publicado" : "fecha_generado";
  const value = getCellValueSoft(row, headerMap, field);

  if (!value) return NaN;

  return Date.parse(value);
}

function getPostKey(row, headerMap, postTipo, fallbackIndex) {
  const carouselId = getCellValueSoft(row, headerMap, "carousel_id");

  if (postTipo === "carousel" && carouselId) {
    return `carousel:${carouselId}`;
  }

  return `single:${fallbackIndex}`;
}

function getUsedBgHistory(rows, headerMap, limit = Infinity) {
  const posts = new Map();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const postTipo = getCellValueSoft(row, headerMap, "post_tipo").toLowerCase();
    const bg = getCellValueSoft(row, headerMap, "background_color");
    const estadoGeneral = getCellValueSoft(row, headerMap, "estado_general").toLowerCase();
    const estadoRender = getCellValueSoft(row, headerMap, "estado_render").toLowerCase();
    const estadoPublish = getCellValueSoft(row, headerMap, "estado_publish").toLowerCase();

    if (!["single", "carousel"].includes(postTipo)) continue;
    if (!bg) continue;

    const isPublished = estadoGeneral === GENERAL_STATUS.PUBLISHED;
    const isInFlight =
      estadoRender === STATUS.DONE &&
      (
        estadoPublish === STATUS.PENDING ||
        estadoPublish === STATUS.ERROR ||
        estadoPublish === STATUS.PROCESSING
      );

    if (!isPublished && !isInFlight) continue;

    const timestamp = getRowTimestamp(row, headerMap, isPublished);
    if (Number.isNaN(timestamp)) continue;

    const postKey = getPostKey(row, headerMap, postTipo, i);
    const existing = posts.get(postKey);

    if (!existing || timestamp > existing.timestamp) {
      posts.set(postKey, {
        bg: bg.toLowerCase().trim(),
        timestamp
      });
    }
  }

  return [...posts.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map(item => item.bg);
}

function getRecentUsedBgs(rows, headerMap, limit = RANDOM_HISTORY_SIZE) {
  return getUsedBgHistory(rows, headerMap, limit);
}

function getCurrentCycleUsedPaletteIds(usedBgs = []) {
  const usedIds = new Set();

  for (const bg of usedBgs) {
    const paletteId = getPaletteIdByBg(bg);
    if (!paletteId) continue;

    // The first repeated palette marks the previous cycle boundary.
    if (usedIds.has(paletteId)) break;

    usedIds.add(paletteId);

    if (usedIds.size >= PALETTES_IN_CYCLE.length) {
      return new Set();
    }
  }

  return usedIds;
}

function pickRandomPalette(candidates) {
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function filterFarFromRecent(candidates, recentBgs = []) {
  const recent = recentBgs
    .map(bg => (bg || "").toLowerCase().trim())
    .filter(Boolean)
    .slice(0, RANDOM_HISTORY_SIZE);

  return candidates.filter(candidate => {
    return !recent.some(recentBg => areSimilarColors(candidate.bg, recentBg));
  });
}

function getNextBackgroundColor(rows, headerMap) {
  const usedHistory = getUsedBgHistory(rows, headerMap);
  const recentBgs = usedHistory.slice(0, RANDOM_HISTORY_SIZE);
  const usedInCycle = getCurrentCycleUsedPaletteIds(usedHistory);

  const unusedInCycle = PALETTES_IN_CYCLE.filter(candidate => {
    return !usedInCycle.has(candidate.id);
  });

  let available = filterFarFromRecent(unusedInCycle, recentBgs);

  // Prefer distance from the last 6 posts, even if the full cycle is exhausted.
  if (!available.length) {
    available = filterFarFromRecent(PALETTES_IN_CYCLE, recentBgs);
  }

  // If similarity filtering blocks too much, at least avoid exact repeats.
  if (!available.length) {
    available = PALETTES_IN_CYCLE.filter(candidate => {
      return !recentBgs.includes(candidate.bg.toLowerCase());
    });
  }

  if (!available.length) {
    available = PALETTES_IN_CYCLE;
  }

  return pickRandomPalette(available).bg;
}

function getRandomColorAvoidingSimilar(recentBgs = []) {
  const available = filterFarFromRecent(PALETTES_IN_CYCLE, recentBgs);
  const candidates = available.length ? available : PALETTES_IN_CYCLE;
  return pickRandomPalette(candidates).bg;
}

function getLastUsedBg(rows, headerMap) {
  return getRecentUsedBgs(rows, headerMap, 1)[0] || "";
}

function getRandomColorExcept(lastColor) {
  return getRandomColorAvoidingSimilar([lastColor]);
}

module.exports = {
  getNextBackgroundColor,
  getUsedBgHistory,
  getRecentUsedBgs,
  getRandomColorAvoidingSimilar,
  getLastUsedBg,
  getRandomColorExcept
};
