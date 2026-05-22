require("dotenv").config();

const fs = require("fs");
const path = require("path");
const http = require("http");
const net = require("net");
const serveStatic = require("serve-static");
const finalhandler = require("finalhandler");
const { chromium } = require("playwright");

const GENERATOR_PORT = Number(process.env.GENERATOR_PORT || 5173);
const GENERATOR_URL = (
  process.env.GENERATOR_URL || `http://127.0.0.1:${GENERATOR_PORT}`
).replace(/\/+$/, "");

const ROOT_DIR = path.join(__dirname, "..", "..");

// El servidor vive durante todo el proceso. Esta promesa se resuelve
// cuando está listo, y se reutiliza en llamadas concurrentes.
let serverReadyPromise = null;

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket
      .once("connect", () => { socket.destroy(); resolve(true); })
      .once("error", () => resolve(false))
      .connect(port, "127.0.0.1");
  });
}

function ensureServer() {
  // Si ya hay una promesa en curso (o resuelta), la reutilizamos.
  // Esto evita que dos renders simultáneos levanten el servidor dos veces.
  if (serverReadyPromise) return serverReadyPromise;

  serverReadyPromise = (async () => {
    const running = await isPortInUse(GENERATOR_PORT);
    if (running) {
      // Puerto ocupado por un proceso externo: lo usamos tal cual,
      // pero no lo gestionamos nosotros (no lo detenemos al salir).
      return;
    }

    const serve = serveStatic(ROOT_DIR, { index: ["index.html"] });
    const server = http.createServer((req, res) => {
      serve(req, res, finalhandler(req, res));
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(GENERATOR_PORT, "127.0.0.1", resolve);
    });

    // Cerramos el servidor limpiamente cuando el proceso termina.
    // Esto cubre tanto exit normal como SIGINT / SIGTERM en GitHub Actions.
    const shutdown = () => server.close();
    process.once("exit", shutdown);
    process.once("SIGINT", () => { shutdown(); process.exit(0); });
    process.once("SIGTERM", () => { shutdown(); process.exit(0); });
  })();

  return serverReadyPromise;
}

function stripAccents(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function buildSafeName(text) {
  const normalized = stripAccents(text);
  return (
    normalized
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 60) || "frase"
  );
}

function buildRenderUrl({ text, mode, bg }) {
  const params = new URLSearchParams({ text, mode, bg });
  return `${GENERATOR_URL}/?${params.toString()}`;
}

async function renderPhrase({ text, mode = "normal", bg = "#ffffff" }) {
  if (!text || !String(text).trim()) {
    throw new Error("No se recibió texto para renderizar.");
  }

  const outputDir = path.join(__dirname, "..", "..", "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const safeName = buildSafeName(String(text));
  const fileName = `${safeName}_${mode}_${Date.now()}.png`;
  const outputPath = path.join(outputDir, fileName);

  await ensureServer();

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 1400 }
    });

    const url = buildRenderUrl({ text, mode, bg });
    console.log("Abriendo:", url.replace(GENERATOR_URL, "***"));

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    await page.waitForFunction(
      () => {
        return (
          window.assetsReady?.watermark &&
          window.assetsReady?.retroLogo &&
          typeof window.getCanvasBase64 === "function"
        );
      },
      { timeout: 15000 }
    );

    await page.waitForTimeout(1200);

    const dataUrl = await page.evaluate(() => window.getCanvasBase64());

    if (!dataUrl || !dataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("El generador no devolvió un PNG válido desde el canvas.");
    }

    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
    fs.writeFileSync(outputPath, base64Data, "base64");

    return { fileName, outputPath };
  } finally {
    // Solo cerramos el browser. El servidor HTTP sigue vivo
    // para el próximo render dentro del mismo proceso.
    await browser.close();
  }
}

module.exports = { renderPhrase };