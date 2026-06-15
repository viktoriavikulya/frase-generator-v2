/* ========= MODE: RETRO 3D ========= */

// Igual que wrapWordsToLines() en mode-brat.js: wrap codicioso y luego
// balanceo para evitar líneas de 1 palabra cuando la siguiente línea tiene
// palabras de sobra. Nombre propio para no chocar con la versión de brat.
function wrapWordsToLinesRetro3D(words, maxWidth, ctxLocal) {
  const lines = [];
  let current = [];

  words.forEach(w => {
    const test  = [...current, w].join(" ");
    const width = ctxLocal.measureText(test).width;
    if (width > maxWidth && current.length > 0) {
      lines.push(current);
      current = [w];
    } else {
      current.push(w);
    }
  });

  if (current.length) lines.push(current);

  const naturalSpace = ctxLocal.measureText(" ").width;

  function lineWidth(line) {
    if (!line.length) return 0;
    const wordsWidth = line.reduce((acc, w) => acc + ctxLocal.measureText(w).width, 0);
    return wordsWidth + (line.length - 1) * naturalSpace;
  }

  for (let i = 0; i < lines.length - 1; i++) {
    let line = lines[i];
    let next = lines[i + 1];

    while (line.length === 1 && next && next.length >= 2) {
      const candidate = [...line, next[0]];
      if (lineWidth(candidate) <= maxWidth) {
        line = candidate;
        next = next.slice(1);
        lines[i] = line;
        if (next.length) {
          lines[i + 1] = next;
        } else {
          lines.splice(i + 1, 1);
          break;
        }
      } else {
        break;
      }
    }
  }

  return lines;
}

// DP sobre la cantidad de líneas. Para cada partición de words en lineCount
// líneas, cada línea recibe su propio fontSize: el más grande en
// [minFont, maxFont] tal que su ancho natural (con espacios normales) quepa
// en targetWidth (getBestFontForLine). Si ni minFont cabe, se usa minFont
// igual (límite físico aceptado, no se parten palabras).
//
// Cada línea se puntúa con:
//   - fillPenalty: qué tan lejos queda la línea de llenar targetWidth.
//   - capPenalty: qué tan lejos queda el fontSize elegido de fontCap (el tope
//     de altura para este lineCount). Una línea puede tener fillRatio≈1 y
//     aun así quedar muy por debajo de fontCap si sus palabras son anchas
//     (tildes, palabras largas) — sin esto el DP no "ve" ese hueco y produce
//     saltos de tamaño bruscos entre líneas vecinas. Esto afecta cómo se
//     reparten las palabras en líneas, no solo qué lineCount gana.
//
// La partición completa además se puntúa con:
//   - heightFillPenalty: qué tan lejos queda el bloque completo de llenar
//     boxHeight.
//   - jumpPenalty: red de seguridad final, penaliza saltos de tamaño
//     bruscos entre líneas vecinas (ratio > maxJumpRatio) que capPenalty no
//     haya evitado.
//
// totalHeight > boxHeight es un descarte duro (nunca desborda verticalmente).
// Si ninguna partición cabe, fallback a wrap codicioso a minFont (nunca una
// sola línea gigante).
function layoutTextBalanced(text, boxWidth, boxHeight, ctxLocal, options = {}) {
  const cfg = { ...RETRO_3D_TEXT_CONFIG, ...options };

  const words            = text.split(/\s+/).filter(Boolean);
  const maxFont          = cfg.maxFont;
  const minFont          = cfg.minFont;
  const lineHeightFactor = cfg.lineHeightFactor;
  const targetWidth      = boxWidth * cfg.targetFill;
  const n                = words.length;

  if (n === 0) return [];

  function setFont(size) {
    ctxLocal.font = `700 ${size}px 'Noto Serif', serif`;
  }

  function naturalWidthAt(lineWords, fontSize) {
    setFont(fontSize);
    const space      = ctxLocal.measureText(" ").width;
    const wordsWidth = lineWords.reduce((acc, w) => acc + ctxLocal.measureText(w).width, 0);
    return wordsWidth + space * (lineWords.length - 1);
  }

  const lineCache = new Map();
  function scoreLine(start, end, fontCap) {
    const key = start + "_" + end + "_" + fontCap;
    if (lineCache.has(key)) return lineCache.get(key);

    const lineWords = words.slice(start, end);

    let low = minFont, high = fontCap, best = minFont;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (naturalWidthAt(lineWords, mid) <= targetWidth) {
        best = mid;
        low  = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const width     = naturalWidthAt(lineWords, best);
    const fillRatio = width / targetWidth;
    const fillScore = Math.pow(1 - fillRatio, 2) * cfg.fillPenalty;

    const capRatio = best / fontCap;
    const capScore = Math.pow(1 - capRatio, 2) * cfg.capPenalty;

    const score = fillScore + capScore;

    const result = { fontSize: best, score };
    lineCache.set(key, result);
    return result;
  }

  function bestFontAt(lineWords, fontCap) {
    let low = minFont, high = fontCap, best = minFont;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (naturalWidthAt(lineWords, mid) <= targetWidth) {
        best = mid;
        low  = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const width = naturalWidthAt(lineWords, best);
    return { fontSize: best, fillRatio: width / targetWidth };
  }

  // Reparación post-DP: el DP elige el lineCount según el costo total de la
  // partición, lo que puede dejar UNA línea muy por debajo de targetWidth
  // (fillRatio bajo) aunque el resto de líneas estén bien justificadas — el
  // costo de esa línea queda "absorbido" por el buen heightFillRatio del
  // conjunto. Aquí priorizamos el llenado horizontal: si la línea con peor
  // fillRatio está por debajo de outlierFillThreshold, se fusiona con el
  // vecino que produzca el mejor fillRatio mínimo resultante (recalculando
  // fontSize para el nuevo lineCount, que tiene un fontCap mayor). Se repite
  // hasta que ninguna línea quede por debajo del umbral o solo quede una.
  function repairOutlierLines(layoutLines) {
    let current = layoutLines.map(item => ({
      words:     item.words,
      fontSize:  item.fontSize,
      fillRatio: naturalWidthAt(item.words, item.fontSize) / targetWidth
    }));

    while (current.length > 1) {
      let minIdx = 0;
      for (let i = 1; i < current.length; i++) {
        if (current[i].fillRatio < current[minIdx].fillRatio) minIdx = i;
      }
      if (current[minIdx].fillRatio >= cfg.outlierFillThreshold) break;

      const newLineCount = current.length - 1;
      const fontCapNew = Math.max(minFont, Math.min(maxFont, Math.floor(boxHeight / (newLineCount * lineHeightFactor))));

      function mergeWith(neighborIdx) {
        const a = Math.min(minIdx, neighborIdx);
        const b = Math.max(minIdx, neighborIdx);
        const mergedWords = [...current[a].words, ...current[b].words];
        const result = [];
        for (let i = 0; i < current.length; i++) {
          if (i === b) continue;
          const lineWords = i === a ? mergedWords : current[i].words;
          const best      = bestFontAt(lineWords, fontCapNew);
          result.push({ words: lineWords, fontSize: best.fontSize, fillRatio: best.fillRatio });
        }
        return result;
      }

      const candidates = [];
      if (minIdx > 0) candidates.push(mergeWith(minIdx - 1));
      if (minIdx < current.length - 1) candidates.push(mergeWith(minIdx + 1));

      let bestCandidate = null, bestCandidateMin = current[minIdx].fillRatio;
      for (const cand of candidates) {
        const candMin = Math.min(...cand.map(l => l.fillRatio));
        if (candMin > bestCandidateMin) {
          bestCandidateMin = candMin;
          bestCandidate    = cand;
        }
      }

      if (!bestCandidate) break;
      current = bestCandidate;
    }

    return current.map(item => ({
      text:     item.words.join(" "),
      words:    item.words,
      fontSize: item.fontSize
    }));
  }

  let bestLayout = null;
  let bestScore  = Infinity;

  for (let lineCount = 1; lineCount <= n; lineCount++) {
    // Tope de fontSize para esta cantidad de líneas: ninguna línea puede
    // superar su "cuota justa" de boxHeight, así totalHeight <= boxHeight
    // queda garantizado y ninguna palabra corta puede dispararse al maxFont
    // global y reventar el presupuesto de altura de este lineCount.
    const fontCap = Math.max(minFont, Math.min(maxFont, Math.floor(boxHeight / (lineCount * lineHeightFactor))));

    const dp   = Array.from({ length: lineCount + 1 }, () => Array(n + 1).fill(Infinity));
    const prev = Array.from({ length: lineCount + 1 }, () => Array(n + 1).fill(-1));

    dp[0][0] = 0;

    for (let line = 1; line <= lineCount; line++) {
      for (let end = line; end <= n; end++) {
        for (let start = line - 1; start < end; start++) {
          if (dp[line - 1][start] === Infinity) continue;

          const result    = scoreLine(start, end, fontCap);
          const candidate = dp[line - 1][start] + result.score;

          if (candidate < dp[line][end]) {
            dp[line][end]   = candidate;
            prev[line][end] = start;
          }
        }
      }
    }

    if (dp[lineCount][n] === Infinity) continue;

    const lines = [];
    let end = n;
    for (let line = lineCount; line >= 1; line--) {
      const start  = prev[line][end];
      const result = scoreLine(start, end, fontCap);

      lines.unshift({
        text:     words.slice(start, end).join(" "),
        words:    words.slice(start, end),
        fontSize: result.fontSize
      });

      end = start;
    }

    const totalHeight = lines.reduce((acc, item) => acc + item.fontSize * lineHeightFactor, 0);
    if (totalHeight > boxHeight) continue;

    const heightFillRatio = totalHeight / boxHeight;
    const heightScore     = Math.pow(1 - heightFillRatio, 2) * cfg.heightFillPenalty;

    let jumpScore = 0;
    for (let i = 0; i < lines.length - 1; i++) {
      const a     = lines[i].fontSize;
      const b     = lines[i + 1].fontSize;
      const ratio = Math.max(a, b) / Math.min(a, b);
      if (ratio > cfg.maxJumpRatio) {
        jumpScore += Math.pow(ratio - cfg.maxJumpRatio, 2) * cfg.jumpPenalty;
      }
    }

    const finalScore = dp[lineCount][n] + heightScore + jumpScore;
    if (finalScore < bestScore) {
      bestScore  = finalScore;
      bestLayout = lines;
    }
  }

  if (!bestLayout) {
    setFont(minFont);
    const fallbackLines = wrapWordsToLinesRetro3D(words, targetWidth, ctxLocal);
    bestLayout = fallbackLines.map(lineWords => ({
      text:     lineWords.join(" "),
      words:    lineWords,
      fontSize: minFont
    }));
    return bestLayout;
  }

  return repairOutlierLines(bestLayout);
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
    maxFont:           cfg.maxFont,
    minFont:           cfg.minFont,
    lineHeightFactor:  cfg.lineHeightFactor,
    targetFill:        cfg.targetFill,
    fillPenalty:       cfg.fillPenalty,
    capPenalty:        cfg.capPenalty,
    heightFillPenalty: cfg.heightFillPenalty,
    maxJumpRatio:      cfg.maxJumpRatio,
    jumpPenalty:       cfg.jumpPenalty,
    outlierFillThreshold: cfg.outlierFillThreshold
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
