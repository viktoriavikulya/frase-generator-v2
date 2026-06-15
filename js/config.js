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

  // Tamaño máximo permitido por línea. Cada línea recibe su propio fontSize
  // (el más grande que entra en targetWidth), acotado por este valor (ver
  // layoutTextBalanced en mode-retro3d.js).
  maxFont: 400,

  // Tamaño mínimo permitido para una línea. Piso real: si ni a este tamaño
  // entra alguna palabra, se usa igual (límite físico aceptado, ver
  // layoutTextBalanced en mode-retro3d.js).
  minFont: 24,

  // Separación vertical entre líneas (multiplicador del fontSize).
  lineHeightFactor: 1.0,

  // Penaliza líneas cuyo ancho natural queda lejos de targetWidth
  // (1 - fillRatio)^2 * fillPenalty.
  fillPenalty: 100,

  // Penaliza líneas cuyo fontSize elegido queda lejos de fontCap (el tope de
  // altura para esa cantidad de líneas), aunque su fillRatio sea ~1.
  // (1 - fontSize/fontCap)^2 * capPenalty. Sin esto, palabras anchas (tildes,
  // palabras largas) pueden quedar "perfectamente justificadas" en ancho pero
  // muy por debajo del tamaño de sus líneas vecinas, creando saltos de tamaño
  // bruscos. Esto afecta cómo el DP reparte las palabras en líneas, no solo
  // qué lineCount gana.
  //
  // En 0: se acepta la variación dramática estilo brat (una línea puede ser
  // mucho más grande que sus vecinas, p.ej. "tiempo" a 229px junto a "para
  // gente" a 152px) a cambio de menor llenado vertical (~85-93%) y de que
  // casos extremos (palabras muy anchas con tildes) puedan quedar con un
  // salto de tamaño visible respecto a sus líneas vecinas. Subir este valor
  // (≈400+) prioriza llenar el alto con líneas más uniformes, pero aplana
  // también la variación dramática deseada. Decisión: 0, se prefiere la
  // variación dramática.
  capPenalty: 0,

  // Penaliza que el bloque completo (suma de fontSize*lineHeightFactor) quede
  // lejos de boxHeight: (1 - heightFillRatio)^2 * heightFillPenalty. Pesa más
  // que jumpPenalty para que llenar el alto gane sobre evitar saltos cuando
  // la diferencia de llenado es grande.
  heightFillPenalty: 600,

  // Relación máxima de fontSize entre líneas vecinas antes de penalizar
  // saltos bruscos.
  maxJumpRatio: 1.8,

  // Peso de la penalización por salto: (ratio - maxJumpRatio)^2 * jumpPenalty.
  jumpPenalty: 40,

  // Ancho objetivo (fracción de boxWidth) usado tanto para el layout
  // (layoutTextBalanced) como referencia de dibujo (drawRetro3DLine).
  targetFill: 1,

  // Llenado horizontal mínimo aceptable por línea. Tras elegir la partición
  // (DP), si alguna línea queda con fillRatio por debajo de este umbral —
  // aunque el conjunto tenga buen heightFillRatio — se fusiona con el vecino
  // que produzca el mejor fillRatio mínimo resultante, recalculando fontSize
  // para el nuevo lineCount (ver repairOutlierLines en mode-retro3d.js). Esto
  // prioriza el llenado horizontal sobre el vertical: el bloque final puede
  // ocupar menos alto, pero ninguna línea queda visiblemente angosta.
  outlierFillThreshold: 0.85
};
