/* ========= RETRO 3D — CONFIG CENTRAL ========= */

// RETRO_PALETTES_START
const RETRO_PALETTES = [
  { id: "retroWhite",    bg: "#f6f1e8", frontColor: "#ff2bd6", midColor: "#ff2bd6", shadowColor: "#39ff14", patternColor: "#7f7a72", patternAlpha: 0.20, inCycle: true },
  { id: "retroBlack",    bg: "#0d0f14", frontColor: "#39ff14", midColor: "#39ff14", shadowColor: "#c600eb", patternColor: "#39ff14", patternAlpha: 0.12, inCycle: true },
  { id: "retroYellow",   bg: "#f4c400", frontColor: "#3d5afe", midColor: "#3d5afe", shadowColor: "#e53935", patternColor: "#8c2f2f", patternAlpha: 0.20, inCycle: true },
  { id: "retroBlue",     bg: "#3d5afe", frontColor: "#e53935", midColor: "#e53935", shadowColor: "#f4c400", patternColor: "#f4c400", patternAlpha: 0.22, inCycle: true },
  { id: "retroRed",      bg: "#e53935", frontColor: "#f4c400", midColor: "#f4c400", shadowColor: "#3d5afe", patternColor: "#f4c400", patternAlpha: 0.32, inCycle: true },
  { id: "retroWine",     bg: "#0d0208", frontColor: "#c9184a", midColor: "#c9184a", shadowColor: "#6a0572", patternColor: null     , patternAlpha: 0.24, inCycle: true },
  { id: "retroPurple",   bg: "#1a0033", frontColor: "#e040fb", midColor: "#e040fb", shadowColor: "#00e5ff", patternColor: null     , patternAlpha: 0.18, inCycle: true },
  { id: "retroNavy",     bg: "#0a1628", frontColor: "#00e5ff", midColor: "#00e5ff", shadowColor: "#e040fb", patternColor: null     , patternAlpha: 0.18, inCycle: true },
  { id: "retroCoffee",   bg: "#1c0a00", frontColor: "#ff6d00", midColor: "#ff6d00", shadowColor: "#c9184a", patternColor: null     , patternAlpha: 0.18, inCycle: true },
  { id: "retroOrange",   bg: "#d9723e", frontColor: "#fff1d6", midColor: "#fff1d6", shadowColor: "#183f4a", patternColor: null     , patternAlpha: 0.30, inCycle: true },
  { id: "retroPink",     bg: "#d4006a", frontColor: "#ffd600", midColor: "#ffd600", shadowColor: "#7a0045", patternColor: "#b8922e", patternAlpha: 0.60, inCycle: true },
  { id: "retroMustard",  bg: "#b28c2c", frontColor: "#3d1a00", midColor: "#3d1a00", shadowColor: "#7a4800", patternColor: null     , patternAlpha: 0.18, inCycle: true },
  { id: "retroGreen",    bg: "#2e7d32", frontColor: "#ffd600", midColor: "#ffd600", shadowColor: "#ff4d00", patternColor: null     , patternAlpha: 0.30, inCycle: true },
  { id: "retroForest",   bg: "#2c4a3e", frontColor: "#e8d5a3", midColor: "#e8d5a3", shadowColor: "#0f1f19", patternColor: null     , patternAlpha: 0.18, inCycle: true },
  { id: "retroPlum",     bg: "#4a2040", frontColor: "#f5c97a", midColor: "#f5c97a", shadowColor: "#1a0818", patternColor: null     , patternAlpha: 0.20, inCycle: true },
  { id: "retroToasted",  bg: "#5c3317", frontColor: "#f2c98a", midColor: "#f2c98a", shadowColor: "#1e0a03", patternColor: "#f2c98a", patternAlpha: 0.22, inCycle: true },
  { id: "retroSlate",    bg: "#2e3f5c", frontColor: "#e8f4f8", midColor: "#e8f4f8", shadowColor: "#0a1628", patternColor: null     , patternAlpha: 0.18, inCycle: true },
  { id: "retroCrimson",  bg: "#7a0020", frontColor: "#ffd600", midColor: "#ffd600", shadowColor: "#2d000b", patternColor: null     , patternAlpha: 0.22, inCycle: true },
  { id: "retroTerra",    bg: "#b85c38", frontColor: "#fff1d6", midColor: "#fff1d6", shadowColor: "#3d1200", patternColor: null     , patternAlpha: 0.25, inCycle: true },
  { id: "retroLavender", bg: "#5c3d8f", frontColor: "#f5e6ff", midColor: "#f5e6ff", shadowColor: "#1a0033", patternColor: null     , patternAlpha: 0.20, inCycle: true },
  { id: "retroOlive",    bg: "#4a5c2e", frontColor: "#e8d5a3", midColor: "#e8d5a3", shadowColor: "#1a2008", patternColor: null     , patternAlpha: 0.20, inCycle: true },
  { id: "retroMint",     bg: "#c8e6c9", frontColor: "#0d2600", midColor: "#0d2600", shadowColor: "#ff6d00", patternColor: null     , patternAlpha: 0.18, inCycle: true },
  { id: "retroSky",      bg: "#b3d9f2", frontColor: "#0a1f40", midColor: "#0a1f40", shadowColor: "#c2185b", patternColor: null     , patternAlpha: 0.18, inCycle: true },
  { id: "retroAsh",      bg: "#d6cfc4", frontColor: "#1a0f00", midColor: "#1a0f00", shadowColor: "#7b3f00", patternColor: null     , patternAlpha: 0.20, inCycle: true },
  { id: "retroNeon",     bg: "#0a0f0a", frontColor: "#b5ff00", midColor: "#b5ff00", shadowColor: "#ff2bd6", patternColor: "#b5ff00", patternAlpha: 0.10, inCycle: true },
  { id: "retroTeal",     bg: "#00695c", frontColor: "#ffd600", midColor: "#ffd600", shadowColor: "#00e5ff", patternColor: null     , patternAlpha: 0.18, inCycle: true },
  { id: "retroGrayDark", bg: "#2e2e2e", frontColor: "#f5f5f5", midColor: "#f5f5f5", shadowColor: "#ff6d00", patternColor: "#f5f5f5", patternAlpha: 0.10, inCycle: true },
  { id: "retroBabyPink", bg: "#f8bbd0", frontColor: "#4a0030", midColor: "#4a0030", shadowColor: "#880e4f", patternColor: null     , patternAlpha: 0.20, inCycle: true },
  { id: "retroLime",     bg: "#76c442", frontColor: "#1a2e00", midColor: "#1a2e00", shadowColor: "#003300", patternColor: null     , patternAlpha: 0.22, inCycle: true },
  { id: "retroSkyDeep",  bg: "#1565c0", frontColor: "#e3f2fd", midColor: "#e3f2fd", shadowColor: "#0d47a1", patternColor: null     , patternAlpha: 0.18, inCycle: true },
];
// RETRO_PALETTES_END



/* ========= FUNCIONES DERIVADAS ========= */

function getPaletteEntry(bg) {
  return RETRO_PALETTES.find(p => p.bg === bg.toLowerCase()) ?? null;
}

function getRetro3DBackground(hex) {
  const normalized = (hex || "").toLowerCase();

  // 1. coincidencia exacta
  const exact = RETRO_PALETTES.find(p => p.bg === normalized);
  if (exact) return exact.bg;

  const input = hexToRgb(normalized);

  // 2. muy cercano a blanco puro → retroWhite
  const whiteDist =
    Math.pow(input.r - 255, 2) +
    Math.pow(input.g - 255, 2) +
    Math.pow(input.b - 255, 2);
  if (whiteDist < 2000) return "#f6f1e8";

  // 3. muy cercano a negro puro → retroBlack
  const blackDist =
    Math.pow(input.r - 10, 2) +
    Math.pow(input.g - 10, 2) +
    Math.pow(input.b - 10, 2);
  if (blackDist < 2000) return "#0d0f14";

  // 4. color más cercano por distancia euclidiana
  let nearest = RETRO_PALETTES[0].bg;
  let minDist  = Infinity;

  for (const entry of RETRO_PALETTES) {
    const c = hexToRgb(entry.bg);
    const dist =
      Math.pow(input.r - c.r, 2) +
      Math.pow(input.g - c.g, 2) +
      Math.pow(input.b - c.b, 2);
    if (dist < minDist) {
      minDist  = dist;
      nearest  = entry.bg;
    }
  }

  return nearest;
}

function getRetro3DPalette(bg) {
  const entry = getPaletteEntry(bg);
  if (!entry) {
    return { frontColor: "#f4c400", midColor: "#f4c400", shadowColor: "#3d5afe" };
  }
  return {
    frontColor:  entry.frontColor,
    midColor:    entry.midColor,
    shadowColor: entry.shadowColor,
  };
}

function getRetroCycle() {
  return RETRO_PALETTES.filter(p => p.inCycle).map(p => p.bg);
}