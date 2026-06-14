/* ========= MODE: RETRO 3D ========= */

function layoutTextBalanced(text, boxWidth, boxHeight, ctxLocal, options = {}) {
  const cfg = { ...RETRO_3D_TEXT_CONFIG, ...options };

  const words           = text.split(/\s+/).filter(Boolean);
  const maxFont         = cfg.maxFont;
  const minFont         = cfg.minFont;
  const lineHeightFactor = cfg.lineHeightFactor;
  const targetFill      = cfg.layoutTargetFill;

  if (words.length === 0) return [];

  function setFont(size) {
    ctxLocal.font = `700 ${size}px 'Noto Serif', serif`;
  }

  function measureWords(lineWords, fontSize) {
    setFont(fontSize);
    const naturalSpace = ctxLocal.measureText(" ").width;
    const wordWidths   = lineWords.map(w => ctxLocal.measureText(w).width);
    const wordsWidth   = wordWidths.reduce((a, b) => a + b, 0);
    const gaps         = lineWords.length - 1;
    return {
      naturalSpace,
      wordWidths,
      wordsWidth,
      naturalWidth: wordsWidth + naturalSpace * gaps,
      gaps
    };
  }

  function getBestFontForLine(lineWords) {
    let low = minFont, high = maxFont, best = minFont;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const m   = measureWords(lineWords, mid);
      if (m.naturalWidth <= boxWidth * targetFill) {
        best = mid;
        low  = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return best;
  }

  function scoreLine(lineWords, isLastLine) {
    const fontSize     = getBestFontForLine(lineWords);
    const m            = measureWords(lineWords, fontSize);
    const fillRatio    = m.naturalWidth / boxWidth;
    const desiredWidth = boxWidth * targetFill;

    let score = 0;

    score += Math.pow(targetFill - fillRatio, 2) * cfg.fillPenalty;

    if (lineWords.length === 1 && words.length > 4) {
      score += cfg.singleWordPenalty;
    }

    if (lineWords.length >= 4) {
      score += Math.pow(lineWords.length - 3, 2) * cfg.manyWordsPenalty;
    }

    if (isLastLine && fillRatio < 0.55 && words.length > 6) {
      score += Math.pow(0.55 - fillRatio, 2) * cfg.lastLineShortPenalty;
    }

    if (m.gaps > 0) {
      const rawSpace       = (desiredWidth - m.wordsWidth) / m.gaps;
      const maxAllowedSpace = m.naturalSpace * cfg.maxSpaceFactor;
      if (rawSpace > maxAllowedSpace) {
        score += Math.pow(rawSpace / m.naturalSpace - cfg.maxSpaceFactor, 2) * cfg.spacePenalty;
      }
    }

    if (fontSize <= minFont + 2) {
      score += cfg.minFontPenalty;
    }

    return { score, fontSize, fillRatio };
  }

  const n        = words.length;
  let bestLayout = null;
  let bestScore  = Infinity;

  const minLines = Math.max(2, Math.ceil(n / 5));
  const maxLines = Math.min(n, Math.max(minLines, Math.ceil(n / 2) + 2));

  for (let lineCount = minLines; lineCount <= maxLines; lineCount++) {
    const dp   = Array.from({ length: lineCount + 1 }, () => Array(n + 1).fill(Infinity));
    const prev = Array.from({ length: lineCount + 1 }, () => Array(n + 1).fill(-1));
    const meta = Array.from({ length: lineCount + 1 }, () => Array(n + 1).fill(null));

    dp[0][0] = 0;

    for (let line = 1; line <= lineCount; line++) {
      for (let end = line; end <= n; end++) {
        for (let start = line - 1; start < end; start++) {
          const lineWords  = words.slice(start, end);
          const isLastLine = line === lineCount;
          const result     = scoreLine(lineWords, isLastLine);
          const candidate  = dp[line - 1][start] + result.score;

          if (candidate < dp[line][end]) {
            dp[line][end]   = candidate;
            prev[line][end] = start;
            meta[line][end] = result;
          }
        }
      }
    }

    if (dp[lineCount][n] === Infinity) continue;

    const lines = [];
    let end = n;

    for (let line = lineCount; line >= 1; line--) {
      const start = prev[line][end];
      if (start < 0) { lines.length = 0; break; }

      const lineWords = words.slice(start, end);
      const result    = meta[line][end];

      lines.unshift({
        text:      lineWords.join(" "),
        words:     lineWords,
        fontSize:  result.fontSize,
        fillRatio: result.fillRatio
      });

      end = start;
    }

    if (!lines.length) continue;

    const totalHeight = lines.reduce((acc, item) => acc + item.fontSize * lineHeightFactor, 0);
    if (totalHeight > boxHeight) continue;

    let jumpPenalty = 0;
    for (let i = 0; i < lines.length - 1; i++) {
      const a     = lines[i].fontSize;
      const b     = lines[i + 1].fontSize;
      const ratio = Math.max(a, b) / Math.min(a, b);
      if (ratio > cfg.maxJumpRatio) {
        jumpPenalty += Math.pow(ratio - cfg.maxJumpRatio, 2) * 100;
      }
    }

    const sizes        = lines.map(l => l.fontSize);
    const maxSize      = Math.max(...sizes);
    const minSizeFound = Math.min(...sizes);
    const variation    = maxSize / minSizeFound;

    let variationBonus = 0;
    if (variation > cfg.variationBonusMin && variation < cfg.variationBonusMax) {
      variationBonus = cfg.variationBonus;
    }

    const finalScore = dp[lineCount][n] + jumpPenalty + variationBonus;
    if (finalScore < bestScore) {
      bestScore  = finalScore;
      bestLayout = lines;
    }
  }

  if (!bestLayout) {
    return [{ text, words, fontSize: minFont, fillRatio: 1 }];
  }

  return bestLayout;
}


// ========= EXPERIMENTAL: detectEditorialKeywords =========
// Elige hasta 2 "palabras clave" para destacar con un tamaño mayor:
// 1. Groserías / intensificadores de una lista predefinida (hasta 2).
// 2. Si no hay match, la palabra más larga + (si es distinta y suficiente-
//    mente significativa) la última palabra de la frase.
// Devuelve un Set con los índices (globales, sobre el array `words`).
const EDITORIAL_STRONG_WORDS = new Set([
  "puta", "puto", "putas", "putos", "mierda", "mierdero", "verga", "carajo",
  "coño", "joder", "pendejo", "pendeja", "cabron", "cabrón", "perra",
  "marica", "hijueputa", "chimba", "nunca", "jamás", "jamas", "siempre",
  "nada", "nadie", "todo", "todos", "matarme", "matar", "muerte", "amor",
  "odio", "dios"
]);

function stripEditorialPunctuation(word) {
  return word.toLowerCase().replace(/^[¿¡"'“‘(]+|["'”’.,;:!?)]+$/g, "");
}

function detectEditorialKeywords(words) {
  const indices = [];

  for (let i = 0; i < words.length; i++) {
    if (EDITORIAL_STRONG_WORDS.has(stripEditorialPunctuation(words[i]))) {
      indices.push(i);
      if (indices.length === 2) break;
    }
  }
  if (indices.length > 0) return new Set(indices);

  let longestIdx = -1;
  let longestLen = 0;
  for (let i = 0; i < words.length; i++) {
    const len = stripEditorialPunctuation(words[i]).length;
    if (len > longestLen) {
      longestLen = len;
      longestIdx = i;
    }
  }
  if (longestIdx >= 0) indices.push(longestIdx);

  const lastIdx = words.length - 1;
  if (lastIdx !== longestIdx && stripEditorialPunctuation(words[lastIdx]).length >= 4) {
    indices.push(lastIdx);
  }

  return new Set(indices.slice(0, 2));
}


// ========= EXPERIMENTAL: layoutEditorial =========
// Rediseño desde cero, sin justify. Dos enfoques posibles según el texto:
//
// - "cita": un único fontSize para toda la frase. Se busca el tamaño más
//   grande tal que el wrap natural (greedy, cada línea <= boxWidth) entre en
//   boxHeight. Cada línea queda con su ancho natural, centrada (sin estirar
//   espacios) — estilo cita editorial.
//
// - "titular+bajada": si la frase tiene una pausa temprana (coma o punto
//   dentro de las primeras 3-6 palabras, con texto suficiente después), se
//   divide en dos bloques. El "titular" (hasta la pausa) y la "bajada"
//   (resto) se ajustan cada uno a su propio tamaño único (mismo método que
//   "cita"), repartiendo boxHeight entre ambos. La bajada nunca queda más
//   grande que el titular (jerarquía tipográfica).
//
// Devuelve { blocks: [{ fontSize, lines: [{ text, width }] }, ...], approach, gap }
function layoutEditorial(text, boxWidth, boxHeight, ctxLocal, options = {}) {
  const cfg = { ...RETRO_3D_TEXT_CONFIG, ...options };

  const maxFont          = cfg.maxFont;
  const minFont          = cfg.minFont;
  const lineHeightFactor = cfg.editorialLineHeightFactor ?? 1.05;
  const titularRatio     = cfg.editorialTitularRatio ?? 0.55;
  const gapRatio         = cfg.editorialGapRatio ?? 0.06;
  const emphasisFactor   = cfg.editorialEmphasisFactor ?? 1.20;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { blocks: [], approach: "empty", gap: 0 };

  const keywordIndices = detectEditorialKeywords(words);

  function setFont(size) {
    ctxLocal.font = `700 ${size}px 'Noto Serif', serif`;
  }

  // measureText escala linealmente con el tamaño de fuente: medimos cada
  // palabra y el espacio una sola vez a un tamaño de referencia y escalamos.
  const REF = 100;
  setFont(REF);
  const refWordWidths = words.map(w => ctxLocal.measureText(w).width);
  const refSpace      = ctxLocal.measureText(" ").width;

  // Wrap "greedy": acumula palabras en la línea actual mientras entren en
  // boxWidth al fontSize dado; si no entra, abre una línea nueva. Las
  // palabras clave (keywordIndices) se miden con emphasisFactor de más,
  // así el wrap ya tiene en cuenta su ancho extra.
  // Una palabra clave solo se destaca si, incluso sola en su línea, su ancho
  // con emphasisFactor entra en boxWidth. Si no entra, se dibuja sin
  // énfasis (scale 1) para evitar que se desborde de la caja de texto.
  function wordScaleFor(idx, scale) {
    if (!keywordIndices.has(idx)) return 1;
    const emphasizedWidth = refWordWidths[idx] * scale * emphasisFactor;
    return emphasizedWidth <= boxWidth ? emphasisFactor : 1;
  }

  function wrapAt(startIdx, count, fontSize) {
    const scale = fontSize / REF;
    const space = refSpace * scale;
    const lines = [];
    let current      = [];
    let currentWidth = 0;
    let currentMaxScale = 1;

    for (let i = 0; i < count; i++) {
      const idx       = startIdx + i;
      const w         = words[idx];
      const wordScale = wordScaleFor(idx, scale);
      const ww        = refWordWidths[idx] * scale * wordScale;

      if (current.length === 0) {
        current         = [{ word: w, scale: wordScale }];
        currentWidth    = ww;
        currentMaxScale = wordScale;
        continue;
      }

      const candidateWidth = currentWidth + space + ww;
      if (candidateWidth <= boxWidth) {
        current.push({ word: w, scale: wordScale });
        currentWidth    = candidateWidth;
        currentMaxScale = Math.max(currentMaxScale, wordScale);
      } else {
        lines.push({ text: current.map(c => c.word).join(" "), width: currentWidth, words: current, maxScale: currentMaxScale });
        current         = [{ word: w, scale: wordScale }];
        currentWidth    = ww;
        currentMaxScale = wordScale;
      }
    }
    if (current.length) {
      lines.push({ text: current.map(c => c.word).join(" "), width: currentWidth, words: current, maxScale: currentMaxScale });
    }
    return lines;
  }

  // Busca el fontSize más grande (<=maxF) tal que el wrap entre en
  // budgetHeight. Las líneas con una palabra clave ocupan más alto
  // (fontSize * maxScale) y eso se tiene en cuenta en la suma.
  function fitBlock(startIdx, count, budgetHeight, maxF) {
    for (let f = maxF; f >= minFont; f--) {
      const lines       = wrapAt(startIdx, count, f);
      const totalHeight = lines.reduce((acc, l) => acc + f * l.maxScale * lineHeightFactor, 0);
      if (totalHeight <= budgetHeight) {
        return { fontSize: f, lines };
      }
    }
    return { fontSize: minFont, lines: wrapAt(startIdx, count, minFont) };
  }

  const n = words.length;

  // Detecta una pausa temprana (coma/punto/etc.) dentro de las primeras
  // 3-6 palabras, dejando al menos 2 palabras de "bajada" después.
  const PAUSE_CHARS    = [",", ".", ";", ":", "!", "?"];
  const maxTitularIdx  = Math.min(5, n - 2);
  let splitIndex = -1;
  for (let i = 2; i <= maxTitularIdx; i++) {
    const w = words[i];
    if (w.length > 0 && PAUSE_CHARS.includes(w[w.length - 1])) {
      splitIndex = i;
      break;
    }
  }

  if (splitIndex === -1) {
    const block = fitBlock(0, n, boxHeight, maxFont);
    return { blocks: [block], approach: "cita", gap: 0 };
  }

  const titularCount = splitIndex + 1;
  const bajadaCount  = n - titularCount;

  const gap            = boxHeight * gapRatio;
  const titularBudget  = boxHeight * titularRatio - gap / 2;
  const bajadaBudget   = boxHeight * (1 - titularRatio) - gap / 2;

  const titular = fitBlock(0, titularCount, titularBudget, maxFont);
  let bajada    = fitBlock(titularCount, bajadaCount, bajadaBudget, maxFont);

  // Jerarquía: la bajada nunca debe quedar más grande que el titular.
  if (bajada.fontSize > titular.fontSize) {
    bajada = { fontSize: titular.fontSize, lines: wrapAt(titularCount, bajadaCount, titular.fontSize) };
  }

  return { blocks: [titular, bajada], approach: "titular+bajada", gap };
}


// ========= EXPERIMENTAL: drawRetro3DEditorial =========
// Variante de drawRetro3D que usa layoutEditorial en vez de
// layoutTextBalanced, y dibuja cada línea sin justify (centrada con su
// ancho natural). No toca fondo, líneas decorativas, logo ni la extrusión
// 3D de drawRetro3DLine.
function drawRetro3DEditorial(rawText, bg) {
  const cfg = RETRO_3D_TEXT_CONFIG;

  ctx.save();

  const text = rawText.trim().replace(/([,;:.!?])(\S)/g, "$1 $2");
  if (!text) { ctx.restore(); return; }

  const normalizedBg = getRetro3DBackground(bg);

  ctx.fillStyle = normalizedBg;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const bgCanvas = document.createElement("canvas");
  bgCanvas.width  = CANVAS_WIDTH;
  bgCanvas.height = CANVAS_HEIGHT;
  const bgCtx = bgCanvas.getContext("2d");

  bgCtx.fillStyle = normalizedBg;
  bgCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  drawRetroPattern(bgCtx, normalizedBg);
  addGrain(bgCtx, 14);

  ctx.drawImage(bgCanvas, 0, 0);
  drawRetroLines();

  const boxWidth  = CANVAS_WIDTH  * cfg.boxWidthRatio;
  const boxHeight = CANVAS_HEIGHT * cfg.boxHeightRatio;
  const centerX   = CANVAS_WIDTH  / 2;
  const centerY   = CANVAS_HEIGHT * cfg.centerYRatio;

  const layout = layoutEditorial(text, boxWidth, boxHeight, ctx, {});

  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";

  const palette          = getRetro3DPalette(normalizedBg);
  const lineHeightFactor = cfg.editorialLineHeightFactor ?? 1.05;

  let totalHeight = 0;
  for (const block of layout.blocks) {
    for (const line of block.lines) {
      totalHeight += block.fontSize * line.maxScale * lineHeightFactor;
    }
  }
  if (layout.blocks.length > 1) totalHeight += layout.gap;

  let y = centerY - totalHeight / 2;

  for (let b = 0; b < layout.blocks.length; b++) {
    const block = layout.blocks[b];

    for (const line of block.lines) {
      const lineHeight = block.fontSize * line.maxScale * lineHeightFactor;
      y += lineHeight / 2;

      drawRetro3DLineEditorial(line.words, centerX, y, {
        frontColor:  palette.frontColor,
        midColor:    palette.midColor,
        shadowColor: palette.shadowColor,
        fontSize:    block.fontSize
      });

      y += lineHeight / 2;
    }

    if (b < layout.blocks.length - 1) y += layout.gap;
  }

  ctx.restore();
}


function drawRetro3D(rawText, bg) {
  const cfg = RETRO_3D_TEXT_CONFIG;

  ctx.save();

  const text = rawText.trim().replace(/([,;:.!?])(\S)/g, "$1 $2");
  if (!text) { ctx.restore(); return; }

  const normalizedBg = getRetro3DBackground(bg);

  ctx.fillStyle = normalizedBg;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const bgCanvas = document.createElement("canvas");
  bgCanvas.width  = CANVAS_WIDTH;
  bgCanvas.height = CANVAS_HEIGHT;
  const bgCtx = bgCanvas.getContext("2d");

  bgCtx.fillStyle = normalizedBg;
  bgCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  drawRetroPattern(bgCtx, normalizedBg);
  addGrain(bgCtx, 14);

  ctx.drawImage(bgCanvas, 0, 0);
  drawRetroLines();

  const boxWidth  = CANVAS_WIDTH  * cfg.boxWidthRatio;
  const boxHeight = CANVAS_HEIGHT * cfg.boxHeightRatio;
  const centerX   = CANVAS_WIDTH  / 2;
  const centerY   = CANVAS_HEIGHT * cfg.centerYRatio;

  const lines = layoutTextBalanced(text, boxWidth, boxHeight, ctx, {
    maxFont:          cfg.maxFont,
    minFont:          cfg.minFont,
    lineHeightFactor: cfg.lineHeightFactor,
    layoutTargetFill: cfg.layoutTargetFill
  });

  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";

  const palette     = getRetro3DPalette(normalizedBg);
  const totalHeight = lines.reduce((acc, item) => acc + item.fontSize * cfg.lineHeightFactor, 0);

  let y = centerY - totalHeight / 2;

  for (const item of lines) {
    const lineHeight = item.fontSize * cfg.lineHeightFactor;
    y += lineHeight / 2;

    drawRetro3DLine(item.text, centerX, y, {
      frontColor:     palette.frontColor,
      midColor:       palette.midColor,
      shadowColor:    palette.shadowColor,
      fontSize:       item.fontSize,
      boxWidth,
      targetFill:     cfg.drawTargetFill,
      justify:        cfg.justify,
      minSpaceFactor: cfg.minSpaceFactor,
      maxSpaceFactor: cfg.maxSpaceFactor
    });

    y += lineHeight / 2;
  }

  ctx.restore();
}


// ========= EXPERIMENTAL: drawRetro3DLineEditorial =========
// Variante de drawRetro3DLine para layoutEditorial: recibe `lineWords`
// (array de { word, scale }) en vez de un string, y dibuja cada palabra
// a su propio tamaño (fontSize * scale) — usado para destacar 1-2 palabras
// clave un 15-25% más grandes. Sin justify; centrado por ancho natural.
// Reutiliza la misma técnica de extrusión 3D que drawRetro3DLine.
function drawRetro3DLineEditorial(lineWords, x, y, opts) {
  const cfg = { ...RETRO_3D_TEXT_CONFIG, ...opts };
  const { frontColor, midColor, shadowColor, fontSize } = cfg;

  if (!lineWords.length) return;

  ctx.save();
  ctx.textBaseline = "middle";

  ctx.font = `700 ${fontSize}px 'Noto Serif', serif`;
  const naturalSpace = ctx.measureText(" ").width;

  const sizes = lineWords.map(({ scale }) => Math.round(fontSize * scale));
  const wordWidths = lineWords.map(({ word }, i) => {
    ctx.font = `700 ${sizes[i]}px 'Noto Serif', serif`;
    return ctx.measureText(word).width;
  });

  const totalWordsW = wordWidths.reduce((a, b) => a + b, 0);
  const gaps        = lineWords.length - 1;
  const actualLineW = totalWordsW + naturalSpace * gaps;

  function getExtrudeColor(depth, i) {
    const t = i / depth;
    if (t > 0.70) return shadowColor;
    if (t > 0.40) return midColor;
    return shadowColor;
  }

  function drawWord(word, size, wx, alignCenter) {
    const depth = Math.max(4, Math.round(size * 0.06));
    ctx.font = `700 ${size}px 'Noto Serif', serif`;
    ctx.textAlign = alignCenter ? "center" : "left";
    for (let i = depth; i >= 1; i--) {
      ctx.fillStyle = getExtrudeColor(depth, i);
      ctx.fillText(word, wx + i, y + i);
    }
    ctx.fillStyle = frontColor;
    ctx.fillText(word, wx, y);
  }

  if (gaps === 0) {
    drawWord(lineWords[0].word, sizes[0], x, true);
    ctx.restore();
    return;
  }

  let cursorX = x - actualLineW / 2;
  for (let i = 0; i < lineWords.length; i++) {
    drawWord(lineWords[i].word, sizes[i], cursorX, false);
    cursorX += wordWidths[i] + naturalSpace;
  }

  ctx.restore();
}


function drawRetro3DLine(line, x, y, opts) {
  const cfg = { ...RETRO_3D_TEXT_CONFIG, ...opts };

  const {
    frontColor, midColor, shadowColor,
    fontSize, boxWidth, targetFill,
    justify, minSpaceFactor, maxSpaceFactor
  } = cfg;

  const depth = Math.max(4, Math.round(fontSize * 0.06));
  const words = line.split(/\s+/).filter(Boolean);
  if (!words.length) return;

  const targetW = boxWidth * targetFill;

  ctx.save();
  ctx.font         = `700 ${fontSize}px 'Noto Serif', serif`;
  ctx.textBaseline = "middle";

  const wordWidths  = words.map(w => ctx.measureText(w).width);
  const totalWordsW = wordWidths.reduce((a, b) => a + b, 0);
  const gaps        = words.length - 1;

  const naturalSpace = ctx.measureText(" ").width;
  const minSpace     = naturalSpace * minSpaceFactor;
  const maxSpace     = naturalSpace * maxSpaceFactor;

  let spaceSize = naturalSpace;
  if (gaps > 0 && justify) {
    const rawSpace = (targetW - totalWordsW) / gaps;
    spaceSize = Math.max(minSpace, Math.min(rawSpace, maxSpace));
  }

  const actualLineW = totalWordsW + spaceSize * gaps;

  function getExtrudeColor(i) {
    const t = i / depth;
    if (t > 0.70) return shadowColor;
    if (t > 0.40) return midColor;
    return shadowColor;
  }

  function drawWord(word, wx) {
    ctx.textAlign = "left";
    for (let i = depth; i >= 1; i--) {
      ctx.fillStyle = getExtrudeColor(i);
      ctx.fillText(word, wx + i, y + i);
    }
    ctx.fillStyle = frontColor;
    ctx.fillText(word, wx, y);
  }

  if (gaps === 0) {
    ctx.textAlign = "center";
    for (let i = depth; i >= 1; i--) {
      ctx.fillStyle = getExtrudeColor(i);
      ctx.fillText(words[0], x + i, y + i);
    }
    ctx.fillStyle = frontColor;
    ctx.fillText(words[0], x, y);
    ctx.restore();
    return;
  }

  let cursorX = x - actualLineW / 2;
  for (let i = 0; i < words.length; i++) {
    drawWord(words[i], cursorX);
    cursorX += wordWidths[i] + spaceSize;
  }

  ctx.restore();
}


function drawCornerTagRetro3D() {
  const tag = "@monacastrosa";

  ctx.save();

  const x = CANVAS_WIDTH / 2;
  const y = 35;

  const normalizedBg = getRetro3DBackground(bgColorInput.value);
  const palette      = getRetro3DPalette(normalizedBg);

  const fontSize = 40;
  const depth    = 3;

  ctx.font          = `700 ${fontSize}px 'Noto Serif', serif`;
  ctx.textAlign     = "center";
  ctx.textBaseline  = "top";

  for (let i = depth; i >= 1; i--) {
    const t = i / depth;
    const extrudeColor = t > 2/3 ? palette.shadowColor
                       : t > 1/3 ? palette.frontColor
                       :           palette.shadowColor;
    ctx.fillStyle = extrudeColor;
    ctx.fillText(tag, x + i, y + i);
  }

  ctx.fillStyle = palette.frontColor;
  ctx.fillText(tag, x, y);

  ctx.restore();
}


function drawRetroLines() {
  ctx.save();

  const normalizedBg = getRetro3DBackground(bgColorInput.value);
  const palette      = getRetro3DPalette(normalizedBg);

  const margin = 38;
  const len    = 120;
  const depth  = 6;

  ctx.lineCap   = "square";
  ctx.lineWidth = 10;

  function drawCornerLines(paths, front, shadow) {
    for (let i = depth; i >= 1; i--) {
      const t = i / depth;
      const extrudeColor = t > 0.7 ? shadow
                         : t > 0.4 ? front
                         :           shadow;
      ctx.strokeStyle = extrudeColor;
      ctx.beginPath();
      for (const [mx, my, lx, ly] of paths) {
        ctx.moveTo(mx + i, my + i);
        ctx.lineTo(lx + i, ly + i);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = front;
    ctx.beginPath();
    for (const [mx, my, lx, ly] of paths) {
      ctx.moveTo(mx, my);
      ctx.lineTo(lx, ly);
    }
    ctx.stroke();
  }

  const front  = palette.frontColor;
  const shadow = palette.shadowColor;

  // esquina superior derecha
  drawCornerLines([
    [CANVAS_WIDTH - margin - len, margin, CANVAS_WIDTH - margin, margin],
    [CANVAS_WIDTH - margin,       margin, CANVAS_WIDTH - margin, margin + len]
  ], front, shadow);

  // esquina inferior izquierda
  drawCornerLines([
    [margin, CANVAS_HEIGHT - margin - len, margin, CANVAS_HEIGHT - margin],
    [margin, CANVAS_HEIGHT - margin,       margin + len, CANVAS_HEIGHT - margin]
  ], front, shadow);

  ctx.restore();
}
