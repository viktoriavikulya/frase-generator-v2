require("dotenv").config();

const fs = require("fs");
const path = require("path");
const http = require("http");
const net = require("net");
const serveStatic = require("serve-static");
const finalhandler = require("finalhandler");
const { chromium } = require("playwright");
const { logger } = require("../utils/logger");

const GENERATOR_PORT = Number(process.env.GENERATOR_PORT || 5173);

const GENERATOR_URL = (
  process.env.GENERATOR_URL || `http://127.0.0.1:${GENERATOR_PORT}`
).replace(/\/+$/, "");

const ROOT_DIR = path.resolve(__dirname, "..", "..");

const RENDER_READY_TIMEOUT_MS = 30_000;

// Dimensiones del canvas — deben coincidir con CANVAS_WIDTH/CANVAS_HEIGHT en app.js
const CANVAS_WIDTH  = 1080;
const CANVAS_HEIGHT = 1350; // FIX #2: era 1080, pero el canvas es 1080×1350

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
  // FIX #14: limpiar el singleton ANTES de cerrar el servidor.
  // Si close() falla, el singleton ya no apunta a la instancia rota,
  // así que el próximo ensureServer() arranca uno nuevo en lugar de
  // reutilizar una promesa resuelta que apunta a nada.
  const instanceToClose = serverInstance;
  const wasOwned = serverOwnedByThisProcess;

  serverReadyPromise = null;
  serverInstance = null;
  serverOwnedByThisProcess = false;

  if (!instanceToClose || !wasOwned) {
    return;
  }

  await new Promise((resolve, reject) => {
    instanceToClose.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Shutdown handlers para señales del SO (SIGTERM, SIGINT)
// ---------------------------------------------------------------------------
// Sin estos handlers, si GitHub Actions cancela el job (SIGTERM) o el usuario
// hace Ctrl+C (SIGINT), el servidor HTTP en el puerto 5173 queda huérfano.
// El próximo render fallará al intentar levantarlo porque el puerto ya está ocupado.

async function handleShutdown(signal) {
  logger.warn(`Señal ${signal} recibida — cerrando servidor de render`, { signal });
  try {
    await stopServer();
  } catch (err) {
    logger.warn("Error al cerrar servidor durante shutdown", { signal, error: err.message });
  }
  // Salida con código 1 para que el proceso reporta terminación forzada
  process.exit(1);
}

process.once("SIGTERM", () => handleShutdown("SIGTERM"));
process.once("SIGINT",  () => handleShutdown("SIGINT"));

// ---------------------------------------------------------------------------

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
    renderEngine: "1",
    text,
    mode,
    bg
  });

  // Fase C7A: panel.html en modo renderEngine=1 reemplaza a index.html como
  // motor de render — ya no depende de que "/" sirva index.html como
  // directory-index.
  return `${GENERATOR_URL}/panel.html?${params.toString()}`;
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

  // FIX: console.log → logger.info para consistencia con el resto del proyecto
  logger.info("Abriendo generador de render", { url });

  // En CI/Render (Linux) se usa el Chromium del sistema; en local (Windows/Mac,
  // donde esa ruta no existe) se deja que Playwright use el Chromium que
  // instaló con `npx playwright install chromium`.
  const FALLBACK_LINUX_CHROMIUM_PATH = '/usr/bin/chromium-browser';
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    || (fs.existsSync(FALLBACK_LINUX_CHROMIUM_PATH) ? FALLBACK_LINUX_CHROMIUM_PATH : undefined);

  const launchOptions = {
    headless: true,
    ...(executablePath ? { executablePath } : {})
  };

  const browser = await chromium.launch(launchOptions);

  try {
    const page = await browser.newPage({
      viewport: {
        width:  CANVAS_WIDTH,
        height: CANVAS_HEIGHT  // FIX #2: ahora usa la constante correcta
      },
      deviceScaleFactor: 1
    });

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