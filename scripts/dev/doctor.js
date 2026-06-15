require("dotenv").config();

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");

const REQUIRED_FILES = [
  "package.json",
  ".github/workflows/publish.yml",
  "panel.html",
  "publicar.html",
  "index.html",
  "scripts/libs/upload-lib.js",
  "scripts/libs/threads-lib.js",
  "scripts/utils/render-utils.js",
  "scripts/utils/pipeline-runner.js",
  "scripts/pipeline/register-from-form.js",
  "scripts/jobs/inspiration/fetch-inspiration.js",
  "scripts/jobs/inspiration/taxonomy.js",
  "scripts/jobs/inspiration/import-saved-tweets-to-sheet.js",
  "scripts/jobs/carousel/build-carousel-plan.js",
  "scripts/dev/archive-curator-server.js",
  "tools/archivo-x-curator.html"
];

const CHECKED_JS_FILES = [
  "scripts/libs/upload-lib.js",
  "scripts/libs/threads-lib.js",
  "scripts/utils/render-utils.js",
  "scripts/utils/pipeline-runner.js",
  "scripts/pipeline/register-from-form.js",
  "scripts/jobs/inspiration/fetch-inspiration.js",
  "scripts/jobs/inspiration/taxonomy.js",
  "scripts/jobs/inspiration/import-saved-tweets-to-sheet.js",
  "scripts/jobs/carousel/build-carousel-plan.js",
  "scripts/dev/archive-curator-server.js",
  "scripts/jobs/single/render-single-from-sheet.js",
  "scripts/jobs/single/upload-single-from-sheet.js",
  "scripts/jobs/single/publish-single-from-sheet.js",
  "scripts/jobs/carousel/render-carousel-from-sheet.js",
  "scripts/jobs/carousel/upload-carousel-from-sheet.js",
  "scripts/jobs/carousel/publish-carousel-from-sheet.js"
];

const STALE_DOC_PATTERNS = [
  { file: "README.md", pattern: /cloudinary_url|npm run check-palettes(?!-sync)/ },
  { file: "CLAUDE.md", pattern: /cloudinary_url|npm run check-palettes(?!-sync)|3 veces al dia|3 veces al día/ },
  { file: "docs/orden para ejecucion.txt", pattern: /-p 8080/ }
];

const results = [];

function record(ok, label, detail = "") {
  results.push({ ok, label, detail });
}

function absolute(relPath) {
  return path.join(ROOT, relPath);
}

function checkRequiredFiles() {
  for (const relPath of REQUIRED_FILES) {
    record(fs.existsSync(absolute(relPath)), `file:${relPath}`);
  }
}

function checkPackageScripts() {
  try {
    const pkg = JSON.parse(fs.readFileSync(absolute("package.json"), "utf8"));
    const scripts = pkg.scripts || {};

    for (const scriptName of [
      "render:single",
      "render:carousel",
      "upload:single",
      "upload:carousel",
      "publish:single",
      "publish:carousel",
      "build:carousel-plan",
      "sync-palettes",
      "check-palettes-sync",
      "doctor",
      "doctor:sheet",
      "fetch:inspiration",
      "import:saved-tweets",
      "curate:archivo-x"
    ]) {
      record(Boolean(scripts[scriptName]), `package script:${scriptName}`);
    }
  } catch (err) {
    record(false, "package.json parse", err.message);
  }
}

function checkSyntax() {
  for (const relPath of CHECKED_JS_FILES) {
    try {
      const source = fs.readFileSync(absolute(relPath), "utf8");
      const wrapped = `(function (exports, require, module, __filename, __dirname) {\n${source}\n});`;
      new vm.Script(wrapped, { filename: relPath });
      record(true, `syntax:${relPath}`);
    } catch (err) {
      record(false, `syntax:${relPath}`, err.message);
    }
  }
}

function checkExports() {
  try {
    const uploadLib = require(absolute("scripts/libs/upload-lib.js"));
    record(typeof uploadLib.uploadImage === "function", "export:uploadImage");
    record(typeof uploadLib.deleteImage === "function", "export:deleteImage");
    record(typeof uploadLib.buildPublicId === "function", "export:buildPublicId");
  } catch (err) {
    record(false, "exports:upload-lib", err.message);
  }

  try {
    const threadsLib = require(absolute("scripts/libs/threads-lib.js"));
    record(typeof threadsLib.threadsGet === "function", "export:threadsGet");
    record(typeof threadsLib.publishThreadsImagePost === "function", "export:publishThreadsImagePost");
    record(typeof threadsLib.publishThreadsCarouselPost === "function", "export:publishThreadsCarouselPost");
  } catch (err) {
    record(false, "exports:threads-lib", err.message);
  }
}

function checkDocs() {
  for (const item of STALE_DOC_PATTERNS) {
    const filePath = absolute(item.file);
    if (!fs.existsSync(filePath)) {
      record(false, `docs:${item.file}`, "missing file");
      continue;
    }

    const content = fs.readFileSync(filePath, "utf8");
    record(!item.pattern.test(content), `docs:${item.file}`);
  }
}

function checkPaletteSync() {
  try {
    const { RETRO_PALETTES: source } = require(absolute("scripts/config/retro-palettes.js"));
    const frontendSrc = fs.readFileSync(absolute("js/palettes.js"), "utf8");
    const startMarker = "// RETRO_PALETTES_START";
    const endMarker = "// RETRO_PALETTES_END";
    const startIdx = frontendSrc.indexOf(startMarker);
    const endIdx = frontendSrc.indexOf(endMarker);

    if (startIdx === -1 || endIdx === -1) {
      record(false, "palettes:sync", "missing RETRO_PALETTES markers");
      return;
    }

    const block = frontendSrc.slice(startIdx + startMarker.length, endIdx).trim();
    const frontend = new Function(`${block}; return RETRO_PALETTES;`)();
    const keys = ["id", "bg", "frontColor", "midColor", "shadowColor", "patternColor", "patternAlpha", "inCycle"];

    if (source.length !== frontend.length) {
      record(false, "palettes:sync", `backend=${source.length} frontend=${frontend.length}`);
      return;
    }

    for (let i = 0; i < source.length; i++) {
      for (const key of keys) {
        if (source[i]?.[key] !== frontend[i]?.[key]) {
          record(false, "palettes:sync", `palette ${source[i]?.id || i} differs at ${key}`);
          return;
        }
      }
    }

    record(true, "palettes:sync");
  } catch (err) {
    record(false, "palettes:sync", err.message);
  }
}

function printResults() {
  let failed = 0;

  for (const item of results) {
    const prefix = item.ok ? "OK" : "FAIL";
    const detail = item.detail ? ` - ${item.detail}` : "";
    console.log(`${prefix} ${item.label}${detail}`);
    if (!item.ok) failed++;
  }

  console.log("");
  console.log(`Doctor: ${results.length - failed} OK, ${failed} FAIL`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

checkRequiredFiles();
checkPackageScripts();
checkSyntax();
checkExports();
checkDocs();
checkPaletteSync();
printResults();
