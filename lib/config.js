export const CONFIG = {
  WEBAPP_URL: "https://usdt-hub-1.vercel.app",
  BOT_USERNAME: "Ussdt_hub_bot",
  ADMIN_ID: process.env.ADMIN_TELEGRAM_ID || "514560",
  SUPPORT_USERNAME: "birr_gram",
  PROOF_CHANNEL_ID: process.env.PROOF_CHANNEL_ID || "@birr_gram",

  CHANNELS: ["@birr_gram", "@usdt_g_ram"],

  WELCOME_USDT: 0.01,
  AD_REWARD: 100, // Boosted ad rewards for new earning features
  MONETAG_LIMIT: 35, // Expanded daily limits
  ADSGRAM_LIMIT: 35,
  HILLTOP_LIMIT: 25,

  REFERRAL_CHANNEL: 300,
  REFERRAL_ADS: 200,
  REFERRAL_TIER_2: 100, // Multi-tier referral bonus feature

  TASK_CREATE_COST: 100000,
  TASK_REWARD: 150,
  TASK_LIMIT: 500,

  WITHDRAW_MIN_POINTS: 10000,
  POINTS_PER_USDT: 100000,

  PROMO_CODES: [
    "USDTHUB", "MONDAYUSDT", "TUESDAYUSDT", "MONEYTIME", "CRYPTOBONUS",
    "BIRRGRAM2026", "FASTUSDT", "DAILYCLAIM", "LUCKYWIN", "REWARD777",
    "TELEGRAMVIP", "EARNMORE", "BINANCEHUB", "FREEUSDT200", "CLAIMNOW",
    "MEGAREWARD", "SUPERPAY", "BOOSTPOINTS", "STARTHUB", "GOLDENUSDT"
  ],
  PROMO_REWARD: 200,

  DAILY_STREAK_REWARDS: [50, 100, 150, 250, 400, 600, 1000], // Expanded streak bonuses

  DEPOSIT_ADDRESS: process.env.DEPOSIT_RECEIVING_ADDRESS || "0x55d398326f99059fF775485246999027B3197955",

  VIP_TIERS: {
    BRONZE: { name: "Bronze", minPts: 0, multiplier: 1.0 },
    SILVER: { name: "Silver", minPts: 25000, multiplier: 1.2 },
    GOLD: { name: "Gold", minPts: 75000, multiplier: 1.4 },
    DIAMOND: { name: "Diamond", minPts: 200000, multiplier: 1.7 },
    WHALE: { name: "Whale VIP", minPts: 500000, multiplier: 2.2 } // New VIP Tier
  }
};
