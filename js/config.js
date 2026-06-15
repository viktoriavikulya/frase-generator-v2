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
  boxHeightRatio: 0.62,

  // Posición vertical del centro del bloque de texto.
  // 0.50 = centro exacto del canvas.
  centerYRatio: 0.50,

  // Tamaño máximo permitido para una línea.
  maxFont: 150,

  // Tamaño mínimo permitido para una línea.
  minFont: 58,

  // Separación vertical entre líneas.
  // 0.88 = líneas más juntas, estilo póster.
  lineHeightFactor: 0.88,

  // Controla qué tanto intenta llenar cada línea al calcular tamaño.
  layoutTargetFill: 1,

  // Controla hasta dónde se estira visualmente la línea al justificar.
  drawTargetFill: 1,

  // Activa o desactiva la justificación entre palabras.
  justify: true,

  // Espacio mínimo permitido entre palabras al justificar.
  minSpaceFactor: 0.70,

  // Espacio máximo permitido entre palabras al justificar.
  maxSpaceFactor: 3.20,

  // Penalización para evitar líneas de una sola palabra en frases medianas/largas.
  singleWordPenalty: 180,

  // Penalización para evitar líneas con demasiadas palabras.
  manyWordsPenalty: 90,

  // Penalización para evitar que la última línea quede muy corta.
  lastLineShortPenalty: 700,

  // Penalización cuando una línea no llena el ancho objetivo.
  fillPenalty: 260,

  // Penalización cuando la justificación requiere espacios demasiado grandes.
  spacePenalty: 80,

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

  // --- EXPERIMENTAL (layoutEditorial / drawRetro3DEditorial) ---

  // Interlineado para el layout editorial (sin justify, más aire que el
  // 0.88 de modo póster).
  editorialLineHeightFactor: 1.05,

  // Cuánto más grande se renderizan las 1-2 "palabras clave" detectadas
  // (1.20 = 20% más grandes que el resto del bloque).
  editorialEmphasisFactor: 1.20,

  // Si el fillRatio de una línea (ancho natural / boxWidth) es menor que
  // este valor, esa línea se justifica estirando espacios (ver
  // maxSpaceFactor/minSpaceFactor). Líneas con fillRatio >= a esto se
  // dibujan sin estirar, como hoy.
  editorialJustifyFillThreshold: 0.85
};
