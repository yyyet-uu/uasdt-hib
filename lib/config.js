const CONFIG = {
  // ==============================
  // TELEGRAM BOT & WEBAPP
  // ==============================
  BOT_TOKEN:
    process.env.TELEGRAM_BOT_TOKEN || "8935158555:AAENaOhNTMkZmdnHR0cLFgVgZ5Hu-jeY6jA",

  BOT_USERNAME:
    process.env.TELEGRAM_BOT_USERNAME || "Ussdt_hub_bot",

  ADMIN_ID:
    process.env.TELEGRAM_ADMIN_ID || "6299182745",

  WEBAPP_URL:
    process.env.WEBAPP_URL || "https://usdt-hub-1.vercel.app",

  SUPPORT_USERNAME:
    process.env.SUPPORT_USERNAME || "birr_gram",

  // ==============================
  // CHANNELS & PROOF SYSTEM
  // ==============================
  CHANNELS: [
    "@birr_gram",
    "@usdt_g_ram"
  ],

  PAYMENT_PROOF_CHANNEL:
    "@birr_gram",

  // ==============================
  // SECURITY & VALIDATION
  // ==============================
  INIT_DATA_MAX_AGE:
    24 * 60 * 60,

  AVIATOR_SERVER_SECRET:
    process.env.AVIATOR_SERVER_SECRET || "USDT_HUB_CRYPTOGRAPHIC_SALT_2026_PROVABLY_FAIR",

  // ==============================
  // WELCOME BONUS (USDT)
  // ==============================
  WELCOME_USDT:
    0.01,

  // ==============================
  // ADS SYSTEM (75 PTS / AD)
  // ==============================
  AD_REWARD:
    75,

  MONETAG_LIMIT:
    25,

  ADSGRAM_LIMIT:
    15,

  ADSGRAM_BLOCK_ID:
    "43948",

  MONETAG_ZONE_ID:
    "11601754",

  // ==============================
  // 7-DAY LOGIN STREAK REWARDS (PTS)
  // ==============================
  DAILY_STREAK_REWARDS: [
    50,   // Day 1
    75,   // Day 2
    100,  // Day 3
    150,  // Day 4
    200,  // Day 5
    300,  // Day 6
    500   // Day 7
  ],

  // ==============================
  // REFERRAL STRUCTURE (1,000 PTS TOTAL)
  // ==============================
  REFERRAL_TOTAL:
    1000,

  REFERRAL_CHANNEL:
    500,

  REFERRAL_ADS:
    500,

  // ==============================
  // TASKS SYSTEM
  // ==============================
  TASK_CREATE_COST:
    100000, // 100,000 PTS = $1.00

  TASK_REWARD:
    150,

  TASK_LIMIT:
    50,

  // ==============================
  // 20 PROMO CODES (200 PTS EACH)
  // ==============================
  PROMO_REWARD:
    200,

  PROMO_CODES: [
    "USDTHUB",
    "MONDAYUSDT",
    "TUESDAYUSDT",
    "MONEYTIME",
    "CRYPTOBONUS",
    "BIRRGRAM2026",
    "FASTUSDT",
    "DAILYCLAIM",
    "LUCKYWIN",
    "REWARD777",
    "TELEGRAMVIP",
    "EARNMORE",
    "BINANCEHUB",
    "FREEUSDT200",
    "CLAIMNOW",
    "MEGAREWARD",
    "SUPERPAY",
    "BOOSTPOINTS",
    "STARTHUB",
    "GOLDENUSDT"
  ],

  // ==============================
  // VIP LEVELS & REWARD MULTIPLIERS
  // ==============================
  VIP_TIERS: {
    BRONZE: { minPts: 0, multiplier: 1.00, name: "Bronze" },
    SILVER: { minPts: 5000, multiplier: 1.05, name: "Silver" },
    GOLD: { minPts: 25000, multiplier: 1.10, name: "Gold" },
    PLATINUM: { minPts: 75000, multiplier: 1.15, name: "Platinum" },
    DIAMOND: { minPts: 200000, multiplier: 1.25, name: "Diamond" }
  },

  // ==============================
  // ECONOMY, WITHDRAW & DEPOSIT
  // 10,000 PTS = 0.10 USDT (100,000 PTS = $1.00)
  // ==============================
  WITHDRAW_MIN_POINTS:
    10000,

  POINTS_PER_USDT:
    100000,

  DEPOSIT_ADDRESS:
    process.env.DEPOSIT_ADDRESS || "0x34A618F95eB74044b7fEb6036E73D68B2588c22f"
};

export { CONFIG };
