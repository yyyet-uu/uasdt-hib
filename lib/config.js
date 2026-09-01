export const CONFIG = {
  // ============================================================
  // 🌐 BASIC BOT / WEB APP CONFIGURATION
  // ============================================================

  WEBAPP_URL: "https://usdt-hub-1.vercel.app",

  BOT_USERNAME: "Ussdt_hub_bot",

  ADMIN_ID:
    process.env.ADMIN_TELEGRAM_ID || "514560",

  SUPPORT_USERNAME: "Usdt_hub_support",

  PROOF_CHANNEL_ID:
    process.env.PROOF_CHANNEL_ID || "@usdt_hub_payment_proof",


  // ============================================================
  // 📢 REQUIRED TELEGRAM CHANNELS
  // ============================================================

  // BOTH channels are mandatory
  CHANNELS: [
    "@usdt_hub_payment_proof",
    "@usdt_g_ram"
  ],


  // ============================================================
  // 🎁 WELCOME BONUS
  // ============================================================

  WELCOME_USDT: 0.01,


  // ============================================================
  // 📺 AD SETTINGS
  // ============================================================

  AD_REWARD: 50,

  MONETAG_LIMIT: 30,

  ADSGRAM_LIMIT: 25,

  HILLTOP_LIMIT: 15,


  // ============================================================
  // 🔥 PREMIUM AD BONUSES
  // ============================================================

  // Bonus for watching the first ad of the day
  FIRST_AD_BONUS: 25,

  // Bonus awarded when the user reaches an ad combo
  AD_COMBO_BONUS: 25,

  // Weekend bonus
  WEEKEND_BONUS: 50,

  // Hours during which ad rewards can receive a double-points bonus.
  // These are UTC hours.
  DOUBLE_POINTS_HOURS: [
    12,
    18
  ],


  // ============================================================
  // 👥 REFERRAL REWARDS
  // ============================================================

  REFERRAL_CHANNEL_JOIN: 200,

  REFERRAL_ADS_WATCHED: 300,


  // ============================================================
  // 🎯 TASK SETTINGS
  // ============================================================

  TASK_CREATE_COST: 100000,

  TASK_REWARD: 150,

  TASK_LIMIT: 500,


  // ============================================================
  // 💸 WITHDRAWAL SETTINGS
  // ============================================================

  WITHDRAW_MIN_POINTS: 10000,

  POINTS_PER_USDT: 100000,


  // ============================================================
  // 🎮 GAMES / ARCADE
  // ============================================================

  // Maximum number of games a user can play per day
  GAME_DAILY_LIMIT: 20,

  // Minimum time between games
  GAME_COOLDOWN_MS: 15 * 1000,

  // Minimum game value
  GAME_MIN_BET: 10,

  // Maximum game value
  GAME_MAX_BET: 500,


  // Rewards used by the server-authoritative game system
  GAME_REWARDS: {
    COINFLIP: 2,
    DICE: 3,
    NUMBER: 5,
    SCRATCH: 4,
    WHEEL: 6,
    MYSTERY: 8
  },


  // ============================================================
  // 🎯 DAILY / WEEKLY / MONTHLY MISSION REWARDS
  // ============================================================

  MISSION_WATCH_ADS_REWARD: 100,

  MISSION_COMPLETE_TASKS_REWARD: 150,

  MISSION_INVITE_REWARD: 150,

  MISSION_CHECKIN_REWARD: 100,

  MISSION_ALL_REWARD: 300,


  // ============================================================
  // 🎁 PROMO CODES
  // ============================================================

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


  // ============================================================
  // 🔥 DAILY STREAK REWARDS
  // ============================================================

  DAILY_STREAK_REWARDS: [
    50,
    75,
    100,
    150,
    200,
    300,
    500
  ],


  // ============================================================
  // 👥 REFERRAL MILESTONES
  // ============================================================

  REFERRAL_MILESTONE_3: 500,

  REFERRAL_MILESTONE_10: 1500,

  REFERRAL_MILESTONE_25: 5000,

  REFERRAL_MILESTONE_50: 15000,


  // ============================================================
  // 💎 VIP SYSTEM
  // ============================================================

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


  // ============================================================
  // 💰 BEP20 / USDT DEPOSIT
  // ============================================================

  DEPOSIT_ADDRESS:
    process.env.DEPOSIT_RECEIVING_ADDRESS ||
    "0x55d398326f99059fF775485246999027B3197955",


  // ============================================================
  // 🏆 REFERRAL CONTEST PRIZES
  // ============================================================

  CONTEST_PRIZES: {
    1: "$20.00",
    2: "$10.00",
    3: "$5.00"
  }
};
