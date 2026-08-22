const CONFIG = {
  // ==============================
  // TELEGRAM
  // ==============================

  BOT_TOKEN:
    process.env.TELEGRAM_BOT_TOKEN || "",

  BOT_USERNAME:
    process.env.TELEGRAM_BOT_USERNAME || "USDTHubBot",

  ADMIN_ID:
    process.env.TELEGRAM_ADMIN_ID || "",

  WEBAPP_URL:
    process.env.WEBAPP_URL || "",

  // ==============================
  // TELEGRAM CHANNELS
  // ==============================

  CHANNELS: [
    "@birr_gram",
    "@usdt_g_ram"
  ],

  // ==============================
  // SECURITY
  // ==============================

  INIT_DATA_MAX_AGE:
    24 * 60 * 60,

  // ==============================
  // WELCOME BONUS
  // ==============================

  WELCOME_USDT:
    0.01,

  // ==============================
  // ADS
  // ==============================

  AD_REWARD:
    0.02,

  MONETAG_LIMIT:
    25,

  ADSGRAM_LIMIT:
    25,

  ADSGRAM_BLOCK_ID:
    "43948",

  // ==============================
  // REFERRALS
  // ==============================

  REFERRAL_CHANNEL:
    0.10,

  REFERRAL_ADS:
    0.10,

  // ==============================
  // TASKS
  // ==============================

  TASK_CREATE_COST:
    1,

  TASK_REWARD:
    0.02,

  TASK_LIMIT:
    50,

  // ==============================
  // PROMO
  // ==============================

  PROMO_REWARD:
    0.10,

  // ==============================
  // WITHDRAW & DEPOSIT
  // ==============================

  WITHDRAW_MIN_POINTS:
    1,

  POINTS_PER_USDT:
    100,

  DEPOSIT_ADDRESS:
    process.env.DEPOSIT_ADDRESS || "0x0000000000000000000000000000000000000000",

  // ==============================
  // MONETAG
  // ==============================

  MONETAG_POSTBACK_SECRET:
    process.env.MONETAG_POSTBACK_SECRET || ""
};

export {
  CONFIG
};
