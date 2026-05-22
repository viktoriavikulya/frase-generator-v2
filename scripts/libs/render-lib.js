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

// render-lib.js está en scripts/libs.
// La raíz real del proyecto queda dos niveles arriba.
const ROOT_DIR = path.resolve(__dirname, "..", "..");

// Tiempo máximo esperando que window.renderReady sea true.
// Cubre descarga de fuentes externas (Google Fonts, CDN de Brat) en GitHub Actions.
const RENDER_READY_TIMEOUT_MS = 30_000;

let serverReadyPromise = null;
let serverInstance = null;
let serverOwnedByThisProcess = false;

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    socket
      .once("connect", () => {
        socket.destroy();
        resolve(true);
      })
      .once("error", () => {
        resolve(false);
      })
      .connect(port, "127.0.0.1");
  });
}

async function ensureServer() {
  if (serverReadyPromise) {
    return serverReadyPromise;
  }

  serverReadyPromise = (async () => {
    const running = await isPortInUse(GENERATOR_PORT);

    if (running) {
      serverOwnedByThisProcess = false;
      return {
        started: false,
        url: GENERATOR_URL,
        port: GENERATOR_PORT
      };
    }

    const serve = serveStatic(ROOT_DIR, {
      index: ["index.html"]
    });

    serverInstance = http.createServer((req, res) => {
      serve(req, res, finalhandler(req, res));
    });

    await new Promise((resolve, reject) => {
      serverInstance.once("error", reject);
      serverInstance.listen(GENERATOR_PORT, "127.0.0.1", resolve);
    });

    serverOwnedByThisProcess = true;

    return {
      started: true,
      url: GENERATOR_URL,
      port: GENERATOR_PORT
    };
  })();

  return serverReadyPromise;
}

async function stopServer() {
  if (!serverInstance || !serverOwnedByThisProcess) {
    serverReadyPromise = null;
    serverInstance = null;
    serverOwnedByThisProcess = false;
    return;
  }

  await new Promise((resolve, reject) => {
    serverInstance.close((err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });

  serverReadyPromise = null;
  serverInstance = null;
  serverOwnedByThisProcess = false;
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
  const params = new URLSearchParams({
    text,
    mode,
    bg
  });

  return `${GENERATOR_URL}/?${params.toString()}`;
}

async function renderPhrase({ text, mode = "normal", bg = "#ffffff" }) {
  if (!text || !String(text).trim()) {
    throw new Error("No se recibió texto para renderizar.");
  }

  await ensureServer();

  const outputDir = path.resolve(__dirname, "..", "..", "output");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, {
      recursive: true
    });
  }

  const safeName = buildSafeName(String(text));
  const fileName = `${safeName}_${mode}_${Date.now()}.png`;
  const outputPath = path.join(outputDir, fileName);
  const url = buildRenderUrl({
    text: String(text),
    mode,
    bg
  });

  console.log("Abriendo:", url);

  const browser = await chromium.launch({
    headless: true
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: 1080,
        height: 1080
      },
      deviceScaleFactor: 1
    });

    // Navegamos con domcontentloaded — es suficiente para que el JS empiece a correr.
    // No usamos networkidle porque las fuentes externas (Google Fonts, CDN de Brat)
    // pueden tardar o fallar en GitHub Actions sin que eso indique un error real.
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60_000
    }).catch((err) => {
      throw new Error(
        `No se pudo abrir el generador en ${url}. ` +
        `Verifica que GENERATOR_URL esté accesible y que marca2.png y marca3.png existan. ` +
        `Detalle: ${err.message}`
      );
    });

    // Esperamos a que app.js setee window.renderReady = true, lo cual ocurre
    // dentro de document.fonts.ready.then(() => { draw(); window.renderReady = true; })
    // Esto garantiza que el canvas ya dibujó con todas las fuentes cargadas.
    await page.waitForFunction(
      () => window.renderReady === true,
      { timeout: RENDER_READY_TIMEOUT_MS }
    ).catch((err) => {
      throw new Error(
        `El generador no completó el render en ${RENDER_READY_TIMEOUT_MS / 1000}s. ` +
        `Puede que una fuente externa no cargó o que window.renderReady no se seteó. ` +
        `Detalle: ${err.message}`
      );
    });

    const dataUrl = await page.evaluate(() => window.getCanvasBase64());

    if (!dataUrl || !dataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("El generador no devolvió un PNG válido desde el canvas.");
    }

    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
    fs.writeFileSync(outputPath, base64Data, "base64");

    return {
      fileName,
      outputPath
    };
  } finally {
    await browser.close();
  }
}

module.exports = {
  renderPhrase,
  stopServer
};