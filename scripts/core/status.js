const STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  DONE: "done",
  ERROR: "error"
};

const GENERAL_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  PUBLISHED: "published",
  ERROR: "error"
};

const POST_TIPOS = {
  SINGLE: "single",
  CAROUSEL: "carousel"
};

const LOCK_STATUS = {
  FREE: "free",
  LOCKED: "locked"
};

const MAX_INTENTOS = 3;

const BG_SEQUENCE = [
  "#f4c400", // retroYellow
  "#3d5afe", // retroBlue
  "#e53935", // retroRed
  "#f6f1e8", // retroWhite
  "#0d0f14"  // retroBlack
];

module.exports = {
  STATUS,
  GENERAL_STATUS,
  POST_TIPOS,
  LOCK_STATUS,
  MAX_INTENTOS,
  BG_SEQUENCE
};