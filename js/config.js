/* ========= SETUP / INIT ========= */

const canvas = document.getElementById("previewCanvas");
const ctx = canvas.getContext("2d");

const assetsReady = {
  watermark: false,
  retroLogo: false
};

const watermarkImage = new Image();
watermarkImage.src = "assets/marca2.png?v=1";
watermarkImage.onload = () => {
  assetsReady.watermark = true;
  draw();
};

const retroLogoImage = new Image();
retroLogoImage.src = "assets/marca3.png?v=1";
retroLogoImage.onload = () => {
  assetsReady.retroLogo = true;
  draw();
};

const input       = document.getElementById("textInput");
const bgColorInput = document.getElementById("bgColor");
const modeSelect  = document.getElementById("modeSelect");
const downloadBtn = document.getElementById("downloadBtn");

const CANVAS_WIDTH  = 1080;
const CANVAS_HEIGHT = 1350;
const PADDING       = window.innerWidth < 600 ? 14 : 20;
const BRAT_STRETCH_Y = 1.3;
window.renderReady = false;

const RETRO_3D_TEXT_CONFIG = {
  // Porcentaje del ancho total del canvas que ocupará la caja del texto.
  boxWidthRatio: 0.76,

  // Porcentaje del alto total del canvas disponible para el bloque de texto.
  boxHeightRatio: 0.70,

  // Posición vertical del centro del bloque de texto.
  // 0.50 = centro exacto del canvas.
  centerYRatio: 0.50,

  // Tamaño máximo permitido para una línea.
  maxFont: 165,

  // Tamaño mínimo permitido para una línea. Actúa como piso real: si una
  // palabra no cabe ni siquiera a este tamaño, esa línea se descarta como
  // inválida (ver getBestFontForLine / scoreLine en mode-retro3d.js).
  minFont: 24,

  // Separación vertical entre líneas.
  // 0.88 = líneas más juntas, estilo póster.
  lineHeightFactor: 1.0,

  // Ancho objetivo (fracción de boxWidth) usado tanto para medir/validar el
  // layout (layoutTextBalanced) como para dibujar (drawRetro3DLine). Un
  // único valor evita que el render dibuje algo más ancho de lo que el
  // layout midió como "cabe".
  targetFill: 1,

  // Penalización para evitar líneas de una sola palabra en frases medianas/largas.
  singleWordPenalty: 180,

  // Penalización para evitar líneas con demasiadas palabras.
  manyWordsPenalty: 90,

  // Penalización para evitar que la última línea quede muy corta.
  lastLineShortPenalty: 700,

  // Penalización cuando una línea no llena el ancho objetivo.
  fillPenalty: 260,

  // Penalización cuando una línea queda cerca del tamaño mínimo.
  minFontPenalty: 20,

  // Máxima diferencia aceptable entre tamaños de líneas vecinas.
  maxJumpRatio: 1.65,

  // Variación mínima para premiar el efecto póster.
  variationBonusMin: 1.15,

  // Variación máxima para premiar el efecto póster.
  variationBonusMax: 1.65,

  // Bono por tener variación agradable de tamaños (negativo = reduce el score).
  variationBonus: -35,

  // Penalización por dejar espacio vertical sin usar (boxHeight no ocupado).
  // Evita que pequeños cambios de texto hagan saltar el layout entre un
  // conteo de líneas que llena el bloque y otro mucho más chato.
  heightFillPenalty: 200
};
