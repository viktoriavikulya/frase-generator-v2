/* ========= MODE: RETRO 3D ========= */


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
// Rediseño desde cero, sin justify. "cita": un único fontSize para toda la
// frase. Se busca el tamaño más grande tal que el wrap natural (greedy, cada
// línea <= boxWidth) entre en boxHeight. Cada línea queda con su ancho
// natural, centrada (sin estirar espacios) — estilo cita editorial.
//
// Devuelve { blocks: [{ fontSize, lines: [{ text, width }] }, ...], approach, gap }
function layoutEditorial(text, boxWidth, boxHeight, ctxLocal, options = {}) {
  const cfg = { ...RETRO_3D_TEXT_CONFIG, ...options };

  const maxFont          = cfg.maxFont;
  const minFont          = cfg.minFont;
  const lineHeightFactor = cfg.editorialLineHeightFactor ?? 1.05;
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

  const block = fitBlock(0, n, boxHeight, maxFont);
  return { blocks: [block], approach: "cita", gap: 0 };
}


// ========= EXPERIMENTAL: drawRetro3DEditorial =========
// Renderer de producción para retro3d: layout editorial con énfasis de
// palabras clave, centrado por ancho natural y extrusión 3D por palabra.
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
        fontSize:    block.fontSize,
        boxWidth,
        fillRatio:   line.width / boxWidth
      });

      y += lineHeight / 2;
    }

    if (b < layout.blocks.length - 1) y += layout.gap;
  }

  ctx.restore();
}


// ========= EXPERIMENTAL: drawRetro3DLineEditorial =========
// Dibuja `lineWords` (array de { word, scale }) para layoutEditorial: cada
// palabra puede tener su propio tamaño (fontSize * scale). Centrado por ancho natural; si fillRatio
// (recibido en opts) es menor a editorialJustifyFillThreshold, estira los
// espacios entre palabras con maxSpaceFactor/minSpaceFactor para acercar la
// línea a boxWidth * drawTargetFill.
function drawRetro3DLineEditorial(lineWords, x, y, opts) {
  const cfg = { ...RETRO_3D_TEXT_CONFIG, ...opts };
  const {
    frontColor, midColor, shadowColor, fontSize,
    boxWidth, fillRatio,
    drawTargetFill, minSpaceFactor, maxSpaceFactor, editorialJustifyFillThreshold
  } = cfg;

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

  let spaceSize = naturalSpace;
  if (gaps > 0 && fillRatio < editorialJustifyFillThreshold) {
    const targetW         = boxWidth * drawTargetFill;
    const rawSpace        = (targetW - totalWordsW) / gaps;
    const minAllowedSpace = naturalSpace * minSpaceFactor;
    const maxAllowedSpace = naturalSpace * maxSpaceFactor;
    spaceSize = Math.max(minAllowedSpace, Math.min(rawSpace, maxAllowedSpace));
  }

  const actualLineW = totalWordsW + spaceSize * gaps;

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
