require("dotenv").config();

// ─── fetch-metrics.js ───────────────────────────────────────────────────────
// Trae métricas de Instagram, Facebook y Threads para cada post publicado
// en los últimos N días y las escribe de vuelta en el Google Sheet.
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
const { threadsGet } = require("../../libs/threads-lib");
const { nowIsoLocal } = require("../../utils/common");
const { logger } = require("../../utils/logger");
const { GENERAL_STATUS } = require("../../core/status");

const IG_ACCESS_TOKEN      = process.env.IG_ACCESS_TOKEN;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const THREADS_ACCESS_TOKEN = process.env.THREADS_ACCESS_TOKEN;

const METRICS_DAYS = Number(process.env.METRICS_DAYS || 30);
const API_DELAY_MS = 1500;

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Instagram ──────────────────────────────────────────────────────────────

async function fetchInstagramInsights(mediaId) {
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
    logger.warn("Error obteniendo métricas de Instagram", { mediaId, error: err.message });
    return null;
  }
}

// ── Facebook ───────────────────────────────────────────────────────────────

async function fetchFacebookInsights(postId) {
  try {
    // Traer likes, comments, shares directamente del post
    const postData = await graphGet(`${postId}`, {
      fields: "likes.summary(true),comments.summary(true),shares",
      access_token: FB_PAGE_ACCESS_TOKEN
    });

    const likes    = postData.likes?.summary?.total_count    ?? 0;
    const comments = postData.comments?.summary?.total_count ?? 0;
    const shares   = postData.shares?.count                  ?? 0;

    // Traer reach y views desde insights
    let reach  = 0;
    let views  = 0;

    try {
      const insightsData = await graphGet(`${postId}/insights`, {
        metric: "post_impressions_unique,post_views_total",
        access_token: FB_PAGE_ACCESS_TOKEN
      });

      for (const item of (insightsData.data || [])) {
        const value = item.values?.[0]?.value ?? item.value ?? 0;
        switch (item.name) {
          case "post_impressions_unique": reach = Number(value); break;
          case "post_views_total":        views = Number(value); break;
        }
      }
    } catch (insightErr) {
      logger.warn("No se pudieron obtener insights de FB (reach/views)", {
        postId,
        error: insightErr.message
      });
    }

    return { likes, comments, shares, reach, views };
  } catch (err) {
    logger.warn("Error obteniendo métricas de Facebook", { postId, error: err.message });
    return null;
  }
}

// ── Threads ────────────────────────────────────────────────────────────────

async function fetchThreadsInsights(mediaId) {
  try {
    const data = await threadsGet(`${mediaId}/insights`, {
      metric:       "views,likes,replies,reposts,quotes",
      access_token: THREADS_ACCESS_TOKEN
    });

    const result = { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0 };

    for (const item of (data.data || [])) {
      const value = item.values?.[0]?.value ?? item.value ?? 0;
      switch (item.name) {
        case "views":   result.views   = Number(value); break;
        case "likes":   result.likes   = Number(value); break;
        case "replies": result.replies = Number(value); break;
        case "reposts": result.reposts = Number(value); break;
        case "quotes":  result.quotes  = Number(value); break;
      }
    }

    return result;
  } catch (err) {
    logger.warn("Error obteniendo métricas de Threads", { mediaId, error: err.message });
    return null;
  }
}

// ── Cálculos ───────────────────────────────────────────────────────────────

function calcIgEngagementRate({ likes, comments, saves, reach }) {
  if (!reach) return "";
  return Math.round(((likes + comments + saves) / reach) * 10000) / 10000;
}

function calcIgPerformanceScore({ likes, comments, saves, reach }) {
  if (!reach) return "";
  return Math.round(((saves * 3 + comments * 2 + likes) / reach) * 10000) / 10000;
}

function calcFbEngagementRate({ likes, comments, shares, reach }) {
  if (!reach) return "";
  return Math.round(((likes + comments + shares) / reach) * 10000) / 10000;
}

function calcThreadsEngagementRate({ likes, replies, reposts, quotes, views }) {
  if (!views) return "";
  return Math.round(((likes + replies + reposts + quotes) / views) * 10000) / 10000;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const log = logger.child({ job: "fetch-metrics" });

  if (!IG_ACCESS_TOKEN)      throw new Error("Falta IG_ACCESS_TOKEN en .env");
  if (!FB_PAGE_ACCESS_TOKEN) throw new Error("Falta FB_PAGE_ACCESS_TOKEN en .env");
  if (!THREADS_ACCESS_TOKEN) throw new Error("Falta THREADS_ACCESS_TOKEN en .env");

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
    "instagram_media_id", "facebook_post_id", "threads_media_id",
    "estado_general", "fecha_publicado",
    "ig_likes", "ig_comments", "ig_saves", "ig_reach", "ig_views",
    "ig_engagement_rate", "ig_performance_score",
    "fb_likes", "fb_comments", "fb_shares", "fb_reach", "fb_views",
    "fb_engagement_rate",
    "threads_views", "threads_likes", "threads_replies",
    "threads_reposts", "threads_quotes", "threads_engagement_rate",
    "fecha_metricas"
  ]);

  const cutoff   = Date.now() - METRICS_DAYS * 24 * 60 * 60 * 1000;
  const eligible = [];

  for (let i = 1; i < rows.length; i++) {
    const row       = rows[i];
    const rowNumber = i + 1;

    const estadoGeneral  = getCellValue(row, headerMap, "estado_general").toLowerCase();
    const igMediaId      = getCellValue(row, headerMap, "instagram_media_id");
    const fechaPublicado = getCellValue(row, headerMap, "fecha_publicado");

    if (estadoGeneral !== GENERAL_STATUS.PUBLISHED) continue;
    if (!igMediaId) continue;
    if (!fechaPublicado) continue;

    const publishedAt = Date.parse(fechaPublicado);
    if (Number.isNaN(publishedAt) || publishedAt < cutoff) continue;

    eligible.push({ rowNumber, row });
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
    const { rowNumber, row } = item;

    const igMediaId   = getCellValue(row, headerMap, "instagram_media_id");
    const fbPostId    = getCellValue(row, headerMap, "facebook_post_id");
    const threadsId   = getCellValue(row, headerMap, "threads_media_id");

    log.info("Obteniendo métricas", { rowNumber, igMediaId, fbPostId, threadsId });

    let anySuccess = false;

    // ── Instagram
    const igMetrics = await fetchInstagramInsights(igMediaId);
    await sleep(API_DELAY_MS);

    if (igMetrics) {
      anySuccess = true;
      const igEngagement    = calcIgEngagementRate(igMetrics);
      const igPerformance   = calcIgPerformanceScore(igMetrics);

      batchUpdates.push(
        { row: rowNumber, col: headerMap["ig_likes"]             + 1, value: igMetrics.likes },
        { row: rowNumber, col: headerMap["ig_comments"]          + 1, value: igMetrics.comments },
        { row: rowNumber, col: headerMap["ig_saves"]             + 1, value: igMetrics.saves },
        { row: rowNumber, col: headerMap["ig_reach"]             + 1, value: igMetrics.reach },
        { row: rowNumber, col: headerMap["ig_views"]             + 1, value: igMetrics.views },
        { row: rowNumber, col: headerMap["ig_engagement_rate"]   + 1, value: igEngagement },
        { row: rowNumber, col: headerMap["ig_performance_score"] + 1, value: igPerformance }
      );

      log.info("Métricas IG obtenidas", { rowNumber, ...igMetrics });
    } else {
      failed++;
      log.warn("No se pudieron obtener métricas de Instagram", { rowNumber, igMediaId });
    }

    // ── Facebook
    if (fbPostId) {
      const fbMetrics = await fetchFacebookInsights(fbPostId);
      await sleep(API_DELAY_MS);

      if (fbMetrics) {
        anySuccess = true;
        const fbEngagement = calcFbEngagementRate(fbMetrics);

        batchUpdates.push(
          { row: rowNumber, col: headerMap["fb_likes"]           + 1, value: fbMetrics.likes },
          { row: rowNumber, col: headerMap["fb_comments"]        + 1, value: fbMetrics.comments },
          { row: rowNumber, col: headerMap["fb_shares"]          + 1, value: fbMetrics.shares },
          { row: rowNumber, col: headerMap["fb_reach"]           + 1, value: fbMetrics.reach },
          { row: rowNumber, col: headerMap["fb_views"]           + 1, value: fbMetrics.views },
          { row: rowNumber, col: headerMap["fb_engagement_rate"] + 1, value: fbEngagement }
        );

        log.info("Métricas FB obtenidas", { rowNumber, ...fbMetrics });
      } else {
        log.warn("No se pudieron obtener métricas de Facebook", { rowNumber, fbPostId });
      }
    }

    // ── Threads
    if (threadsId) {
      const threadsMetrics = await fetchThreadsInsights(threadsId);
      await sleep(API_DELAY_MS);

      if (threadsMetrics) {
        anySuccess = true;
        const threadsEngagement = calcThreadsEngagementRate(threadsMetrics);

        batchUpdates.push(
          { row: rowNumber, col: headerMap["threads_views"]           + 1, value: threadsMetrics.views },
          { row: rowNumber, col: headerMap["threads_likes"]           + 1, value: threadsMetrics.likes },
          { row: rowNumber, col: headerMap["threads_replies"]         + 1, value: threadsMetrics.replies },
          { row: rowNumber, col: headerMap["threads_reposts"]         + 1, value: threadsMetrics.reposts },
          { row: rowNumber, col: headerMap["threads_quotes"]          + 1, value: threadsMetrics.quotes },
          { row: rowNumber, col: headerMap["threads_engagement_rate"] + 1, value: threadsEngagement }
        );

        log.info("Métricas Threads obtenidas", { rowNumber, ...threadsMetrics });
      } else {
        log.warn("No se pudieron obtener métricas de Threads", { rowNumber, threadsId });
      }
    }

    if (anySuccess) {
      batchUpdates.push(
        { row: rowNumber, col: headerMap["fecha_metricas"] + 1, value: now }
      );
      updated++;
    }

    if (batchUpdates.length >= 80) {
      await updateCellsBatch(sheets, batchUpdates.splice(0));
      log.info("Batch parcial escrito al sheet");
    }
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