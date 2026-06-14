// MEJORA #10: BG_SEQUENCE eliminado de aquí — no tiene relación con estados del pipeline.
// Importalo directo desde retro-palettes.js donde lo necesites:
//   const { BG_SEQUENCE } = require("../config/retro-palettes");

const STATUS         = { PENDING: "pending", PROCESSING: "processing", DONE: "done",      ERROR: "error"  };
const GENERAL_STATUS = { PENDING: "pending", PROCESSING: "processing", PUBLISHED: "published", ERROR: "error" };
const POST_TIPOS     = { SINGLE: "single", CAROUSEL: "carousel" };
const LOCK_STATUS    = { FREE: "free", LOCKED: "locked" };
const MAX_INTENTOS   = 3;

module.exports = { STATUS, GENERAL_STATUS, POST_TIPOS, LOCK_STATUS, MAX_INTENTOS };