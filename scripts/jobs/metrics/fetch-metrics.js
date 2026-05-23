require("dotenv").config();

// ─── fetch-metrics.js ───────────────────────────────────────────────────────
// Trae métricas de Instagram para cada post publicado en los últimos N días
// y las escribe de vuelta en el Google Sheet.
//
// Columnas que debe tener el sheet:
//   instagram_media_id, likes, comments, saves, reach, views,
//   engagement_rate, performance_score, fecha_metricas
//
// Uso:
//   node scripts/jobs/metrics/fetch-metrics.js
//   METRICS_DAYS=60 node scripts/jobs/metrics/fetch-metrics.js
// ───────────────────────────────────────────────────────────────────────────

const {
  getSheetsClient,
  buildHeaderMap,
  requireHeaders,
  getCellValue,
  readRows,
  updateCellsBatch
} = require("../../core/sheets");

const { graphGet } = require("../../libs/graph-client");
const { nowIsoLocal } = require("../../utils/common");
const { logger } = require("../../utils/logger");
const { GENERAL_STATUS } = require("../../core/status");

const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;

const METRICS_DAYS = Number(process.env.METRICS_DAYS || 30);
const API_DELAY_MS = 1500;

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchMediaInsights(mediaId) {
  try {
    const data = await graphGet(`${mediaId}/insights`, {
      metric: "views,reach,saved,likes,comments",
      access_token: IG_ACCESS_TOKEN
    });

    const result = { views: 0, reach: 0, saves: 0, likes: 0, comments: 0 };

    for (const item of (data.data || [])) {
      const value = item.values?.[0]?.value ?? item.value ?? 0;

      switch (item.name) {
        case "views":    result.views    = Number(value); break;
        case "reach":    result.reach    = Number(value); break;
        case "saved":    result.saves    = Number(value); break;
        case "likes":    result.likes    = Number(value); break;
        case "comments": result.comments = Number(value); break;
      }
    }

    return result;
  } catch (err) {
    logger.warn("Error detallado al obtener métricas", { mediaId, error: err.message });
    return null;
  }
}

function calcPerformanceScore({ likes, comments, saves, reach }) {
  if (!reach || reach === 0) return "";
  const raw = (saves * 3 + comments * 2 + likes) / reach;
  return Math.round(raw * 10000) / 10000;
}

function calcEngagementRate({ likes, comments, saves, reach }) {
  if (!reach || reach === 0) return "";
  const raw = (likes + comments + saves) / reach;
  return Math.round(raw * 10000) / 10000;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const log = logger.child({ job: "fetch-metrics" });

  if (!IG_ACCESS_TOKEN) {
    throw new Error("Falta IG_ACCESS_TOKEN en .env");
  }

  log.info("Iniciando recolección de métricas", { days: METRICS_DAYS });

  const sheets = await getSheetsClient();
  const rows   = await readRows(sheets);

  if (rows.length < 2) {
    log.info("No hay datos en la hoja");
    return;
  }

  const headers   = rows[0];
  const headerMap = buildHeaderMap(headers);

  requireHeaders(headerMap, [
    "instagram_media_id",
    "estado_general",
    "fecha_publicado",
    "likes",
    "comments",
    "saves",
    "reach",
    "views",
    "engagement_rate",
    "performance_score",
    "fecha_metricas"
  ]);

  const cutoff = Date.now() - METRICS_DAYS * 24 * 60 * 60 * 1000;
  const eligible = [];

  for (let i = 1; i < rows.length; i++) {
    const row        = rows[i];
    const rowNumber  = i + 1;

    const estadoGeneral  = getCellValue(row, headerMap, "estado_general").toLowerCase();
    const mediaId        = getCellValue(row, headerMap, "instagram_media_id");
    const fechaPublicado = getCellValue(row, headerMap, "fecha_publicado");

    if (estadoGeneral !== GENERAL_STATUS.PUBLISHED) continue;
    if (!mediaId) continue;
    if (!fechaPublicado) continue;

    const publishedAt = Date.parse(fechaPublicado);
    if (Number.isNaN(publishedAt) || publishedAt < cutoff) continue;

    eligible.push({ rowNumber, row, mediaId });
  }

  log.info(`Posts elegibles para métricas: ${eligible.length}`);

  if (!eligible.length) {
    log.info("Nada que actualizar. Saliendo.");
    return;
  }

  let updated = 0;
  let failed  = 0;
  const batchUpdates = [];
  const now = nowIsoLocal();

  for (const item of eligible) {
    const { rowNumber, mediaId } = item;

    log.info("Obteniendo métricas", { rowNumber, mediaId });

    const metrics = await fetchMediaInsights(mediaId);

    if (!metrics) {
      log.warn("No se pudieron obtener métricas", { rowNumber, mediaId });
      failed++;
      await sleep(API_DELAY_MS);
      continue;
    }

    const engagementRate   = calcEngagementRate(metrics);
    const performanceScore = calcPerformanceScore(metrics);

    log.info("Métricas obtenidas", {
      rowNumber,
      mediaId,
      ...metrics,
      engagement_rate:   engagementRate,
      performance_score: performanceScore
    });

    batchUpdates.push(
      { row: rowNumber, col: headerMap["likes"]             + 1, value: metrics.likes },
      { row: rowNumber, col: headerMap["comments"]          + 1, value: metrics.comments },
      { row: rowNumber, col: headerMap["saves"]             + 1, value: metrics.saves },
      { row: rowNumber, col: headerMap["reach"]             + 1, value: metrics.reach },
      { row: rowNumber, col: headerMap["views"]             + 1, value: metrics.views },
      { row: rowNumber, col: headerMap["engagement_rate"]   + 1, value: engagementRate },
      { row: rowNumber, col: headerMap["performance_score"] + 1, value: performanceScore },
      { row: rowNumber, col: headerMap["fecha_metricas"]    + 1, value: now }
    );

    updated++;

    if (batchUpdates.length >= 80) {
      await updateCellsBatch(sheets, batchUpdates.splice(0));
      log.info("Batch parcial escrito al sheet");
    }

    await sleep(API_DELAY_MS);
  }

  if (batchUpdates.length) {
    await updateCellsBatch(sheets, batchUpdates.splice(0));
  }

  log.info("Recolección de métricas completada", {
    updated,
    failed,
    total: eligible.length
  });
}

main().catch(err => {
  logger.error("Error fatal en fetch-metrics", {}, err);
  process.exit(1);
});