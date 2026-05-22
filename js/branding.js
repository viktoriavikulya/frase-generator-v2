/* ========= OVERLAYS / BRANDING ========= */

function drawWatermark() {
  if (!watermarkImage.complete) return;

  const size = CANVAS_WIDTH * 1.1;

  const temp  = document.createElement("canvas");
  temp.width  = CANVAS_WIDTH;
  temp.height = CANVAS_HEIGHT;
  const tctx  = temp.getContext("2d");

  tctx.save();
  tctx.shadowColor   = "rgba(0,0,0,0.40)";
  tctx.shadowBlur    = 8;
  tctx.shadowOffsetX = 4;
  tctx.shadowOffsetY = 4;

  tctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
  tctx.drawImage(watermarkImage, -size / 2, -size / 2, size, size);
  tctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.drawImage(temp, 0, 0);
  ctx.restore();
}

function drawAEStyleText() {
  const textLines = ["\u00A0MONA", "\u00A0\u00A0\u00A0\u00A0CASTROSA"];

  // 1. Canvas temporal para fabricar el STROKE OUTSIDE
  const temp  = document.createElement("canvas");
  temp.width  = CANVAS_WIDTH;
  temp.height = CANVAS_HEIGHT;
  const tctx  = temp.getContext("2d");

  const x           = CANVAS_WIDTH / 2 + 220;
  const y           = CANVAS_HEIGHT * 0.78 - 15;
  const fontSize    = 90;
  const lineSpacing = fontSize * 0.9;

  tctx.font          = `${fontSize}px 'OPTICashew-ExtraBold'`;
  tctx.textAlign     = "center";
  tctx.textBaseline  = "middle";
  tctx.globalAlpha   = 1.0;
  tctx.strokeStyle   = "black";
  tctx.lineWidth     = 16;

  for (let i = 0; i < textLines.length; i++) {
    tctx.strokeText(textLines[i], x, y + (i - 0.5) * lineSpacing);
  }

  tctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < textLines.length; i++) {
    tctx.fillText(textLines[i], x, y + (i - 0.5) * lineSpacing);
  }

  // 2. Canvas final para sombra + relleno
  const finalCanvas  = document.createElement("canvas");
  finalCanvas.width  = CANVAS_WIDTH;
  finalCanvas.height = CANVAS_HEIGHT;
  const fctx         = finalCanvas.getContext("2d");

  fctx.shadowColor   = "rgba(0,0,0,0.80)";
  fctx.shadowBlur    = 5;
  fctx.shadowOffsetX = 4;
  fctx.shadowOffsetY = 4;
  fctx.drawImage(temp, 0, 0);

  fctx.shadowBlur   = 0;
  fctx.globalAlpha  = 1.0;
  fctx.fillStyle    = "white";
  fctx.font         = `${fontSize}px 'OPTICashew-ExtraBold'`;
  fctx.textAlign    = "center";
  fctx.textBaseline = "middle";

  for (let i = 0; i < textLines.length; i++) {
    fctx.fillText(textLines[i], x, y + (i - 0.5) * lineSpacing);
  }

  // 3. Alpha global bajo y draw final
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.drawImage(finalCanvas, 0, 0);
  ctx.restore();
}

function drawCornerTagBrat() {
  const tag = "@monacastrosa";

  ctx.save();

  const padding   = 45;
  const x         = CANVAS_WIDTH  - padding;
  const y         = CANVAS_HEIGHT - padding;
  const bg        = bgColorInput.value;
  const textColor = getContrastColor(bg);

  ctx.filter       = "blur(2px)";
  ctx.shadowColor  = textColor === "#ffffff"
    ? "rgba(255,255,255,0.45)"
    : "rgba(0,0,0,0.45)";
  ctx.shadowBlur    = 10;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 3;

  ctx.font          = `35px arial_narrowregular, 'Arial Narrow', sans-serif`;
  ctx.textAlign     = "right";
  ctx.textBaseline  = "bottom";
  ctx.fillStyle     = textColor;
  ctx.strokeStyle   = textColor === "#000000" ? "#ffffff" : "#000000";
  ctx.lineWidth     = 4;

  ctx.translate(x, y);
  ctx.scale(1, BRAT_STRETCH_Y);
  ctx.translate(-x, -y);

  ctx.strokeText(tag, x, y);
  ctx.fillText(tag,   x, y);

  ctx.restore();
}

function drawCornerTagNormal() {
  const tag = "@monacastrosa";

  ctx.save();

  const padding   = 45;
  const x         = CANVAS_WIDTH  - padding;
  const y         = CANVAS_HEIGHT - padding;
  const bg        = bgColorInput.value;
  const textColor = getContrastColor(bg);

  ctx.shadowColor  = textColor === "#ffffff"
    ? "rgba(255,255,255,0.45)"
    : "rgba(0,0,0,0.45)";
  ctx.shadowBlur    = 6;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 3;

  ctx.font         = `42px 'Felt Tip Roman', cursive`;
  ctx.textAlign    = "right";
  ctx.textBaseline = "bottom";
  ctx.fillStyle    = textColor;
  ctx.strokeStyle  = textColor === "#000000" ? "#ffffff" : "#000000";
  ctx.lineWidth    = 3;

  ctx.strokeText(tag, x, y);
  ctx.fillText(tag,   x, y);

  ctx.restore();
}

function drawRetroCornerLogo() {
  if (!retroLogoImage.complete)       return;
  if (modeSelect.value !== "retro3d") return;

  const size          = 200;
  const paddingBottom = 25;
  const x             = CANVAS_WIDTH / 2 - size / 2;
  const y             = CANVAS_HEIGHT - paddingBottom - size;

  ctx.save();
  ctx.drawImage(retroLogoImage, x, y, size, size);
  ctx.restore();
}
