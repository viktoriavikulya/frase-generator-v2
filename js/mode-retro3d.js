/* ========= MODE: RETRO 3D ========= */

function layoutTextBalanced(text, boxWidth, boxHeight, ctxLocal, options = {}) {
  const cfg = { ...RETRO_3D_TEXT_CONFIG, ...options };

  const words           = text.split(/\s+/).filter(Boolean);
  const maxFont         = cfg.maxFont;
  const minFont         = cfg.minFont;
  const lineHeightFactor = cfg.lineHeightFactor;
  const targetFill      = cfg.targetFill;

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

  // Devuelve el fontSize más grande en [minFont, maxFont] tal que la línea
  // cabe horizontalmente (ancho natural y la palabra más ancha, ambos <=
  // boxWidth * targetFill). Si ninguna talla del rango cabe, devuelve null:
  // la línea es inválida y no debe entrar al DP como candidata.
  function getBestFontForLine(lineWords) {
    let low = minFont, high = maxFont, best = null;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const m   = measureWords(lineWords, mid);
      const maxWordWidth = Math.max(...m.wordWidths);
      const fits = m.naturalWidth <= boxWidth * targetFill
                 && maxWordWidth   <= boxWidth * targetFill;
      if (fits) {
        best = mid;
        low  = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return best;
  }

  function scoreLine(lineWords, isLastLine) {
    const fontSize = getBestFontForLine(lineWords);
    if (fontSize === null) {
      return { score: Infinity, fontSize: null, fillRatio: null };
    }
    const m         = measureWords(lineWords, fontSize);
    const fillRatio = m.naturalWidth / boxWidth;

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

    // Penaliza dejar mucho espacio vertical sin usar, para que el conteo de
    // líneas elegido no dependa solo del ajuste por línea sino también de
    // cuánto del boxHeight ocupa el bloque completo.
    const heightDeficit = Math.max(0, 1 - totalHeight / boxHeight);
    const heightFillPenalty = Math.pow(heightDeficit, 2) * cfg.heightFillPenalty;

    const finalScore = dp[lineCount][n] + jumpPenalty + variationBonus + heightFillPenalty;
    if (finalScore < bestScore) {
      bestScore  = finalScore;
      bestLayout = lines;
    }
  }

  // Último recurso: ningún lineCount produjo un layout válido (caso
  // extremo). En vez de devolver todo el texto en una sola línea a minFont
  // (que casi seguro se saldría del canvas), se hace un wrap "greedy" a
  // minFont: cada línea agrupa palabras mientras quepan a minFont, igual
  // que el resto del layout valida. Sigue sin partir palabras: una sola
  // palabra que no quepa ni a minFont queda sola en su línea.
  if (!bestLayout) {
    const greedyLines = [];
    let current = [];

    for (const word of words) {
      const candidate = [...current, word];
      const fits = measureWords(candidate, minFont).naturalWidth <= boxWidth * targetFill;

      if (current.length > 0 && !fits) {
        greedyLines.push(current);
        current = [word];
      } else {
        current = candidate;
      }
    }
    if (current.length) greedyLines.push(current);

    return greedyLines.map(lineWords => ({
      text:      lineWords.join(" "),
      words:     lineWords,
      fontSize:  minFont,
      fillRatio: measureWords(lineWords, minFont).naturalWidth / boxWidth
    }));
  }

  return bestLayout;
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
    targetFill:       cfg.targetFill
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
      frontColor:  palette.frontColor,
      midColor:    palette.midColor,
      shadowColor: palette.shadowColor,
      fontSize:    item.fontSize
    });

    y += lineHeight / 2;
  }

  ctx.restore();
}


function drawRetro3DLine(line, x, y, opts) {
  const cfg = { ...RETRO_3D_TEXT_CONFIG, ...opts };

  const { frontColor, midColor, shadowColor, fontSize } = cfg;

  const depth = Math.max(4, Math.round(fontSize * 0.06));
  const words = line.split(/\s+/).filter(Boolean);
  if (!words.length) return;

  ctx.save();
  ctx.font         = `700 ${fontSize}px 'Noto Serif', serif`;
  ctx.textBaseline = "middle";

  const wordWidths  = words.map(w => ctx.measureText(w).width);
  const totalWordsW = wordWidths.reduce((a, b) => a + b, 0);
  const gaps        = words.length - 1;

  const spaceSize   = ctx.measureText(" ").width;
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
