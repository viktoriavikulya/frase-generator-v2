/* ========= VISUAL UTILS ========= */

function drawRetroPattern(targetCtx, bg) {
  const palette  = getRetro3DPalette(bg);
  const entry    = getPaletteEntry(bg);

  const patternColor = entry?.patternColor ?? palette.shadowColor ?? palette.frontColor;
  const alpha        = entry?.patternAlpha ?? (getBrightness(bg) < 100 ? 0.12 : 0.18);

  targetCtx.save();
  targetCtx.fillStyle = hexToRgba(patternColor, alpha);
  targetCtx.font = "700 26px 'Noto Serif', serif";
  targetCtx.textAlign = "left";
  targetCtx.textBaseline = "middle";

  const text = "@monacastrosa";
  const amplitude = 10;

  const charWidths = [];
  for (const ch of text) {
    charWidths.push(targetCtx.measureText(ch).width);
  }
  const totalTextWidth = charWidths.reduce((a, b) => a + b, 0);

  // horizontal tileable
  const reps = Math.round(CANVAS_WIDTH / (totalTextWidth + 10));
  const stepX = CANVAS_WIDTH / reps;
  const scale = stepX / totalTextWidth;

  // sampleStep proporcional al ancho medio de carácter
  const avgCharWidth = (totalTextWidth / text.length) * scale;
  const sampleStep = Math.max(2, avgCharWidth * 0.5);

  // vertical tileable
  const rowsCount = Math.round(CANVAS_HEIGHT / 28);
  const stepY = CANVAS_HEIGHT / rowsCount;

  // arranca un paso antes para cubrir borde superior con cualquier amplitude
  const startY = -(stepY + amplitude);

  for (
    let row = 0, baseY = startY;
    baseY < CANVAS_HEIGHT + stepY + amplitude;
    row++, baseY += stepY
  ) {
    const rowShift = (row % 2) * (stepX / 2);
    const startX = -stepX / 2 + rowShift;

    for (let tileX = startX; tileX < CANVAS_WIDTH + stepX; tileX += stepX) {
      let cursorX = tileX;

      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const cw = charWidths[i] * scale;
        const cx = cursorX + cw / 2;

        const waveY =
          baseY + Math.sin((2 * Math.PI * cx) / CANVAS_WIDTH) * amplitude;

        const waveYNext =
          baseY + Math.sin((2 * Math.PI * (cx + sampleStep)) / CANVAS_WIDTH) * amplitude;

        const angle = Math.atan2(waveYNext - waveY, sampleStep);

        targetCtx.save();
        targetCtx.translate(cx, waveY);
        targetCtx.rotate(angle);
        targetCtx.scale(scale, 1);
        targetCtx.fillText(ch, -charWidths[i] / 2, 0);
        targetCtx.restore();

        cursorX += cw;
      }
    }
  }

  targetCtx.restore();
}

function addGrain(targetCtx, amount = 15) {
  const imageData = targetCtx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * amount;
    data[i]     += noise;
    data[i + 1] += noise;
    data[i + 2] += noise;
  }

  targetCtx.putImageData(imageData, 0, 0);
}

function getContrastColor(hex) {
  hex = hex.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 150 ? "#000000" : "#ffffff";
}

function getBrightness(hex) {
  hex = hex.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function hexToRgb(hex) {
  hex = hex.replace("#", "");
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
