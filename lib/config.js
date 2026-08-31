export const CONFIG = {
  WEBAPP_URL: "https://usdt-hub-1.vercel.app",

  BOT_USERNAME: "Ussdt_hub_bot",

  ADMIN_ID: process.env.ADMIN_TELEGRAM_ID || "514560",

  SUPPORT_USERNAME: "Usdt_hub_support",

  PROOF_CHANNEL_ID:
    process.env.PROOF_CHANNEL_ID || "@usdt_hub_payment_proof",

  // BOTH channels are mandatory
  CHANNELS: [
    "@usdt_hub_payment_proof",
    "@usdt_g_ram"
  ],

  WELCOME_USDT: 0.01,

  // Ads
  AD_REWARD: 50,
  MONETAG_LIMIT: 30,
  ADSGRAM_LIMIT: 25,
  HILLTOP_LIMIT: 15,

  // Referral rewards
  REFERRAL_CHANNEL_JOIN: 200,
  REFERRAL_ADS_WATCHED: 300,

  // Tasks
  TASK_CREATE_COST: 100000,
  TASK_REWARD: 150,
  TASK_LIMIT: 500,

  // Withdraw
  WITHDRAW_MIN_POINTS: 10000,
  POINTS_PER_USDT: 100000,

  // Promo codes
  PROMO_CODES: [
    "USDTHUB2026",
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

  PROMO_REWARD: 200,

  // Daily streak
  DAILY_STREAK_REWARDS: [
    50,
    75,
    100,
    150,
    200,
    300,
    500
  ],

  // BEP20 deposit address
  DEPOSIT_ADDRESS:
    process.env.DEPOSIT_RECEIVING_ADDRESS ||
    "0x55d398326f99059fF775485246999027B3197955",

  POINTS_PER_USDT: 100000,

  // VIP
  VIP_TIERS: {
    BRONZE: {
      name: "Bronze",
      minPts: 0,
      multiplier: 1.0
    },

    SILVER: {
      name: "Silver",
      minPts: 25000,
      multiplier: 1.15
    },

    GOLD: {
      name: "Gold",
      minPts: 75000,
      multiplier: 1.3
    },

    DIAMOND: {
      name: "Diamond",
      minPts: 200000,
      multiplier: 1.5
    }
  },

  // Referral contest
  CONTEST_PRIZES: {
    1: "$20.00",
    2: "$10.00",
    3: "$5.00"
  }
};
