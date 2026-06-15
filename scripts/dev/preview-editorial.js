require("dotenv").config();

const fs = require("fs");
const path = require("path");
const http = require("http");
const net = require("net");
const serveStatic = require("serve-static");
const finalhandler = require("finalhandler");
const { chromium } = require("playwright");

const GENERATOR_PORT = Number(process.env.GENERATOR_PORT || 5173);
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const OUTPUT_DIR = path.join(ROOT_DIR, "output");

const PHRASES = [
  "¿Quién pa estudiar y hacer coworking?",
  "A tu vida sexual le falta calle.",
  "Anhelar un cigarrillo es tan gracioso. Oh, mi dosis diaria de matarme.",
  "Tengo un fetiche por proporcionar momentos inolvidables a las personas antes de desaparecer de sus vidas.",
  "A mí me llegan a embolatar la matrícula cero y armo un mierdero",
  "Mor, diga que va a votar y yo le boto esos bóxer pa' la puta mierda.",
  "A lo mejor no encuentras el amor porque eres el problema y Dios está cuidando a las otras personas de ti.",
  "Esta es una prueba para saber si el codigo funciona correctamente",
  "Desperté, estoy soltera, duermo 8 horas, voy al gym, estoy tranquila, no envío párrafos de cómo quiero ser tratada, estoy linda, trabajo, estudio y no me interesa ningún hombre."
];

const BG = "#2e3f5c";

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket
      .once("connect", () => { socket.destroy(); resolve(true); })
      .once("error", () => resolve(false))
      .connect(port, "127.0.0.1");
  });
}

async function ensureServer() {
  const running = await isPortInUse(GENERATOR_PORT);
  if (running) return { owned: false };

  const serve = serveStatic(ROOT_DIR, { index: ["index.html"] });
  const server = http.createServer((req, res) => serve(req, res, finalhandler(req, res)));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(GENERATOR_PORT, "127.0.0.1", resolve);
  });
  return { owned: true, server };
}

function safeName(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñ]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const phrases = process.argv[2] ? [process.argv[2]] : PHRASES;

  const { owned, server } = await ensureServer();

  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newPage({
      viewport: { width: 1080, height: 1350 },
      deviceScaleFactor: 1
    });

    await page.goto(`http://127.0.0.1:${GENERATOR_PORT}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await page.evaluate(() => document.fonts.ready);

    const results = await page.evaluate(({ phrases, bg }) => {
      return phrases.map((text) => {
        const normalizedText = text.trim().replace(/([,;:.!?])(\S)/g, "$1 $2");

        drawRetro3DEditorial(normalizedText, bg);
        drawRetroCornerLogo();
        drawCornerTagRetro3D();

        const cfg = RETRO_3D_TEXT_CONFIG;
        const boxWidth  = CANVAS_WIDTH  * cfg.boxWidthRatio;
        const boxHeight = CANVAS_HEIGHT * cfg.boxHeightRatio;
        const layout = layoutEditorial(normalizedText, boxWidth, boxHeight, ctx, {});

        const dataUrl = canvas.toDataURL("image/png");

        return {
          text,
          approach: layout.approach,
          blocks: layout.blocks.map(b => ({
            fontSize: b.fontSize,
            lines: b.lines.map(l => ({
              text: l.text,
              maxScale: l.maxScale,
              words: l.words.map(w => `${w.word}${w.scale > 1 ? `(x${w.scale})` : ""}`)
            }))
          })),
          dataUrl
        };
      });
    }, { phrases, bg: BG });

    const paths = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const base64 = r.dataUrl.replace(/^data:image\/png;base64,/, "");
      const filename = `editorial_${i + 1}_${safeName(r.text)}.png`;
      const filePath = path.join(OUTPUT_DIR, filename);
      fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
      paths.push(filePath);

      console.log("=".repeat(80));
      console.log("FRASE:", r.text);
      console.log("approach:", r.approach);
      for (const b of r.blocks) {
        console.log(`  block fontSize=${b.fontSize}px`);
        for (const line of b.lines) {
          console.log(`    "${line.words.join(" ")}"`);
        }
      }
      console.log("PNG:", filePath);
    }
  } finally {
    await browser.close();
    if (owned && server) server.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
