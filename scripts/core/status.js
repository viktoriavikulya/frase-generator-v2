const { BG_SEQUENCE } = require("../libs/retro-palettes");

const STATUS = { PENDING: "pending", PROCESSING: "processing", DONE: "done", ERROR: "error" };
const GENERAL_STATUS = { PENDING: "pending", PROCESSING: "processing", PUBLISHED: "published", ERROR: "error" };
const POST_TIPOS = { SINGLE: "single", CAROUSEL: "carousel" };
const LOCK_STATUS = { FREE: "free", LOCKED: "locked" };
const MAX_INTENTOS = 3;

module.exports = { STATUS, GENERAL_STATUS, POST_TIPOS, LOCK_STATUS, MAX_INTENTOS, BG_SEQUENCE };