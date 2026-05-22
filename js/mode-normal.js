/* ========= MODE: NORMAL ========= */

function drawNormal(text, bg) {
  ctx.save();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = getContrastColor(bg);

  const boxWidth  = CANVAS_WIDTH  * 0.85;
  const boxHeight = CANVAS_HEIGHT * 0.90;

  const boxX = (CANVAS_WIDTH  - boxWidth)  / 2;
  const boxY = (CANVAS_HEIGHT - boxHeight) / 2;

  const maxFont = 130;
  const minFont = 40;

  let fontSize = maxFont;
  let lines = [];

  while (fontSize > minFont) {
    ctx.font = `${fontSize}px 'Felt Tip Roman', cursive`;
    lines = wrapText(text, boxWidth, ctx);

    const totalHeight = lines.length * fontSize * 1.1;
    if (totalHeight <= boxHeight) break;

    fontSize -= 4;
  }

  ctx.font = `${fontSize}px 'Felt Tip Roman', cursive`;
  lines = wrapText(text, boxWidth, ctx);

  const lineHeight  = fontSize * 1;
  const totalHeight = lines.length * lineHeight;

  let y = boxY + (boxHeight - totalHeight) / 2 + lineHeight / 2;

  ctx.shadowColor   = "rgba(0,0,0,0.20)";
  ctx.shadowBlur    = 5;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;

  for (const line of lines) {
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth   = 2.35;
    ctx.strokeText(line, CANVAS_WIDTH / 2, y);
    ctx.fillText(line,   CANVAS_WIDTH / 2, y);
    y += lineHeight;
  }

  ctx.restore();
}

function wrapText(text, maxWidth, ctxLocal) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  // 1) Wrap codicioso normal
  for (const w of words) {
    const test  = current ? current + " " + w : w;
    const width = ctxLocal.measureText(test).width;

    if (width > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }

  if (current) lines.push(current);

  // 2) Evitar última línea de una sola palabra
  if (lines.length >= 2) {
    const last = lines[lines.length - 1];
    const prev = lines[lines.length - 2];

    if (last.split(/\s+/).length === 1) {
      const merged = prev + " " + last;
      if (ctxLocal.measureText(merged).width <= maxWidth * 1.12) {
        lines[lines.length - 2] = merged;
        lines.pop();
      }
    }
  }

  // 3) Rebalanceo suave entre líneas vecinas
  function widthOf(line) {
    return ctxLocal.measureText(line).width;
  }

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < lines.length - 1; i++) {
      const a      = lines[i];
      const b      = lines[i + 1];
      const bWords = b.split(/\s+/);

      if (bWords.length <= 1) continue;

      const aWidth = widthOf(a);
      const bWidth = widthOf(b);

      if (aWidth < bWidth * 0.72) {
        const candidateA = a + " " + bWords[0];
        const candidateB = bWords.slice(1).join(" ");

        if (
          candidateB &&
          widthOf(candidateA) <= maxWidth &&
          candidateB.split(/\s+/).length >= 1
        ) {
          lines[i]     = candidateA;
          lines[i + 1] = candidateB;
        }
      }
    }
  }

  return lines;
}
