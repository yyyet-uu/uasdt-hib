export const CONFIG = {
  // Mini App & Telegram Identifiers
  WEBAPP_URL: process.env.WEBAPP_URL || "https://usdt-hub-1.vercel.app",
  BOT_USERNAME: process.env.BOT_USERNAME || "Ussdt_hub_bot",
  ADMIN_ID: process.env.ADMIN_TELEGRAM_ID || "514560",
  SUPPORT_USERNAME: "birr_gram",
  PROOF_CHANNEL_ID: process.env.PROOF_CHANNEL_ID || "@birr_gram",

  // Mandatory Channels to unlock the app
  CHANNELS: ["@birr_gram", "@usdt_g_ram"],

  // Bonus & Micro-Earning Rates
  WELCOME_USDT: 0.01,
  AD_REWARD: 75,
  MONETAG_LIMIT: 25,
  ADSGRAM_LIMIT: 25,
  HILLTOP_LIMIT: 15,

  // Referral System (300 PTS on join + 200 PTS on 2 ads)
  REFERRAL_CHANNEL: 300,
  REFERRAL_ADS: 200,

  // Community Tasks Engine
  TASK_CREATE_COST: 100000,
  TASK_REWARD: 150,
  TASK_LIMIT: 500,

  // Conversion & Cashouts (10,000 PTS = 0.10 USDT)
  WITHDRAW_MIN_POINTS: 10000,
  POINTS_PER_USDT: 100000,

  // Promo Codes System
  PROMO_CODES: ["WELCOME2026", "USDTHUB", "BONUS200"],
  PROMO_REWARD: 200,

  // 7-Day Login Streak Rewards
  DAILY_STREAK_REWARDS: [50, 75, 100, 150, 200, 300, 500],

  // Deposit Configuration
  DEPOSIT_ADDRESS: process.env.DEPOSIT_RECEIVING_ADDRESS || "0x55d398326f99059fF775485246999027B3197955",

  // Aviator Secret Seed
  AVIATOR_SERVER_SECRET: process.env.AVIATOR_SERVER_SECRET || "USDT_HUB_SECRET_KEY_999",

  // VIP Tier Multipliers
  VIP_TIERS: {
    BRONZE: { name: "Bronze", minPts: 0, multiplier: 1.0 },
    SILVER: { name: "Silver", minPts: 25000, multiplier: 1.15 },
    GOLD: { name: "Gold", minPts: 75000, multiplier: 1.3 },
    DIAMOND: { name: "Diamond", minPts: 200000, multiplier: 1.5 }
  }
};
