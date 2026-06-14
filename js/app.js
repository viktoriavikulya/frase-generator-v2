/* ========= APP FLOW ========= */

function draw() {
  const text = input.value.trim();
  const bg   = bgColorInput.value;
  const mode = modeSelect.value;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  if (mode !== "retro3d") {
    drawWatermark();
    drawAEStyleText();
  }

  if (!text) {
    drawPlaceholder();
  } else {
    if      (mode === "normal")  drawNormal(text, bg);
    else if (mode === "brat")    drawBrat(text, bg);
    else if (mode === "retro3d") drawRetro3DEditorial(text, bg);
  }

  if      (mode === "brat")    drawCornerTagBrat();
  else if (mode === "retro3d") { drawRetroCornerLogo(); drawCornerTagRetro3D(); }
  else                          drawCornerTagNormal();
}

function drawPlaceholder() {
  ctx.save();
  ctx.fillStyle    = "rgba(0,0,0,0.35)";
  ctx.font         = "42px 'Felt Tip Roman', cursive";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("v 97 🐵", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
  ctx.restore();
}

function downloadPNG() {
  const link  = document.createElement("a");
  const mode  = modeSelect.value;
  link.download = "nachozorra_" + mode + "_" + Date.now() + ".png";
  link.href     = canvas.toDataURL("image/png");
  link.click();
}

function generateMultiple() {
  const raw     = input.value;
  const phrases = raw.split("@").map(t => t.trim()).filter(t => t.length > 0);

  if (phrases.length <= 1) {
    alert("Escribe varias frases separadas por @");
    return;
  }

  const originalText = raw;
  const originalBg   = bgColorInput.value;
  const mode         = modeSelect.value;
  const retroCycle   = getRetroCycle();

  let index = 0;

  function next() {
    if (index >= phrases.length) {
      input.value        = originalText;
      bgColorInput.value = originalBg;
      draw();
      alert("Listo: todas las imágenes fueron generadas.");
      return;
    }

    input.value = phrases[index];

    if (mode === "retro3d") {
      bgColorInput.value = retroCycle[index % retroCycle.length];
    }

    draw();

    setTimeout(() => {
      const link        = document.createElement("a");
      const safeMode    = modeSelect.value;
      const colorSuffix = mode === "retro3d" ? `_c${(index % retroCycle.length) + 1}` : "";
      link.download     = `frase_${index + 1}_${safeMode}${colorSuffix}.png`;
      link.href         = canvas.toDataURL("image/png");
      link.click();
      index++;
      next();
    }, 250);
  }

  next();
}


/* ========= ARRANQUE ========= */

function applyUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const text   = params.get("text");
  const mode   = params.get("mode");
  const bg     = params.get("bg");

  if (text !== null) input.value = text;
  if (mode !== null && ["normal", "brat", "retro3d"].includes(mode)) modeSelect.value = mode;
  if (bg   !== null) bgColorInput.value = bg;
}

applyUrlParams();
draw();

document.fonts.ready.then(() => {
  draw();
  window.renderReady = true;
});

input.addEventListener("input",  draw);
bgColorInput.addEventListener("input",  draw);
modeSelect.addEventListener("change", draw);
downloadBtn.addEventListener("click",  downloadPNG);

const multiBtn     = document.createElement("button");
multiBtn.innerText = "Generar múltiples";
multiBtn.className = "px-4 py-2 bg-pink-600 text-white text-sm rounded-lg shadow-md hover:bg-pink-700 active:bg-pink-800";
multiBtn.onclick   = generateMultiple;
document.querySelector(".control-panel").appendChild(multiBtn);


/* ========= EXPORTS ========= */

function getCanvasBase64() {
  return canvas.toDataURL("image/png");
}

window.getCanvasBase64 = getCanvasBase64;
window.draw            = draw;
window.assetsReady     = assetsReady;
