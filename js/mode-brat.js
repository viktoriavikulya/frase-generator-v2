/* ========= MODE: BRAT ========= */

function drawBrat(rawText, bg) {
  ctx.save();

  const text = rawText.trim();
  if (!text) {
    ctx.restore();
    return;
  }

  const textColor = getContrastColor(bg);

  const boxWidth  = CANVAS_WIDTH  * 0.90;
  const boxHeight = CANVAS_HEIGHT * 0.98;
  const boxX      = (CANVAS_WIDTH  - boxWidth)  / 2;
  const boxY      = (CANVAS_HEIGHT - boxHeight) / 2;

  const maxFont = 470;
  const minFont = 20;

  let low       = minFont;
  let high      = maxFont;
  let bestFont  = minFont;
  let bestLines = [];

  // Búsqueda binaria del tamaño de fuente (considerando estiramiento vertical)
  while (low <= high) {
    const mid = (low + high) >> 1;
    ctx.font = `${mid}px arial_narrowregular, 'Arial Narrow', sans-serif`;

    const candidateLines = wrapWordsToLines(text, boxWidth, ctx);
    const totalHeight    = candidateLines.length * mid * 1.1 * BRAT_STRETCH_Y;

    let wordTooWide = false;
    for (const line of candidateLines) {
      for (const w of line) {
        if (ctx.measureText(w).width > boxWidth) {
          wordTooWide = true;
          break;
        }
      }
      if (wordTooWide) break;
    }

    if (!wordTooWide && totalHeight <= boxHeight) {
      bestFont  = mid;
      bestLines = candidateLines;
      low       = mid + 2;
    } else {
      high = mid - 2;
    }
  }

  ctx.font          = `${bestFont}px arial_narrowregular, 'Arial Narrow', sans-serif`;
  ctx.textBaseline  = "top";
  ctx.fillStyle     = textColor;

  const lineHeight  = bestFont * 0.9;
  const blockHeight = bestLines.length * lineHeight * BRAT_STRETCH_Y;
  let y             = boxY + (boxHeight - blockHeight) / 2;

  bestLines.forEach(words => {
    drawJustifiedLineTall(words, boxX, y, boxWidth, ctx);
    y += lineHeight * BRAT_STRETCH_Y;
  });

  ctx.restore();
}

function wrapWordsToLines(text, maxWidth, ctxLocal) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = [];

  // 1. Wrap codicioso normal
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

  // 2. Balanceo: evitar líneas de 1 palabra si se puede
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

function drawJustifiedLine(words, x, y, lineWidth, ctx) {
  if (!words || words.length === 0) return;

  ctx.save();
  ctx.filter       = "blur(5px)";
  ctx.textBaseline = "top";

  const gaps       = words.length - 1;
  const wordWidths = words.map(w => ctx.measureText(w).width);
  const wordsWidth = wordWidths.reduce((a, b) => a + b, 0);

  if (gaps === 0) {
    ctx.fillText(words[0], x, y);
    ctx.restore();
    return;
  }

  const freeSpace = lineWidth - wordsWidth;
  const spaceSize = freeSpace <= 0
    ? ctx.measureText(" ").width
    : freeSpace / gaps;

  let cursorX = x;
  for (let i = 0; i < words.length; i++) {
    ctx.fillText(words[i], cursorX, y);
    if (i < gaps) cursorX += wordWidths[i] + spaceSize;
  }

  ctx.restore();
}

function drawJustifiedLineTall(words, x, y, lineWidth, ctx) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, BRAT_STRETCH_Y);
  drawJustifiedLine(words, 0, 0, lineWidth, ctx);
  ctx.restore();
}
