export const CONFIG = {
  WEBAPP_URL: "https://usdt-hub-1.vercel.app",
  BOT_USERNAME: "Ussdt_hub_bot",
  ADMIN_ID: process.env.ADMIN_TELEGRAM_ID || "514560",
  SUPPORT_USERNAME: "Usdt_hub_support", // Updated Support Username
  PROOF_CHANNEL_ID: process.env.PROOF_CHANNEL_ID || "@usdt_hub_payment_proof", // Updated Proof Channel

  CHANNELS: ["@usdt_hub_payment_proof", "@usdt_g_ram"],

  WELCOME_USDT: 0.01,
  AD_REWARD: 50, // Updated to 50 PTS per ad
  MONETAG_LIMIT: 30, // Increased to 30 ads per day
  ADSGRAM_LIMIT: 25,
  HILLTOP_LIMIT: 15,

  // Referral Rewards Structure
  REFERRAL_CHANNEL_JOIN: 200, // 200 PTS when referral joins channel
  REFERRAL_ADS_WATCHED: 300,  // 300 PTS after referral watches 2 ads

  TASK_CREATE_COST: 100000,
  TASK_REWARD: 150,
  TASK_LIMIT: 500,

  WITHDRAW_MIN_POINTS: 10000,
  POINTS_PER_USDT: 100000,

  // 20 Rotating Promo Codes for Daily 24-Hour Drops
  PROMO_CODES: [
    "USDTHUB2026", "MONDAYUSDT", "TUESDAYUSDT", "MONEYTIME", "CRYPTOBONUS",
    "BIRRGRAM2026", "FASTUSDT", "DAILYCLAIM", "LUCKYWIN", "REWARD777",
    "TELEGRAMVIP", "EARNMORE", "BINANCEHUB", "FREEUSDT200", "CLAIMNOW",
    "MEGAREWARD", "SUPERPAY", "BOOSTPOINTS", "STARTHUB", "GOLDENUSDT"
  ],
  PROMO_REWARD: 200,

  DAILY_STREAK_REWARDS: [50, 75, 100, 150, 200, 300, 500],

  DEPOSIT_ADDRESS: process.env.DEPOSIT_RECEIVING_ADDRESS || "0x55d398326f99059fF775485246999027B3197955",

  VIP_TIERS: {
    BRONZE: { name: "Bronze", minPts: 0, multiplier: 1.0 },
    SILVER: { name: "Silver", minPts: 25000, multiplier: 1.15 },
    GOLD: { name: "Gold", minPts: 75000, multiplier: 1.3 },
    DIAMOND: { name: "Diamond", minPts: 200000, multiplier: 1.5 }
  },

  // Referral Contest Prizes
  CONTEST_PRIZES: {
    1: "$20.00",
    2: "$10.00",
    3: "$5.00"
  }
};
