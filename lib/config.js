export const CONFIG = {
  WEBAPP_URL: "https://usdt-hub-1.vercel.app",[span_1](start_span)[span_1](end_span)

  BOT_USERNAME: "Ussdt_hub_bot",[span_2](start_span)[span_2](end_span)

  ADMIN_ID: process.env.ADMIN_TELEGRAM_ID || "514560",[span_3](start_span)[span_3](end_span)

  SUPPORT_USERNAME: "Usdt_hub_support",[span_4](start_span)[span_4](end_span)

  PROOF_CHANNEL_ID:
    process.env.PROOF_CHANNEL_ID || "@usdt_hub_payment_proof",[span_5](start_span)[span_5](end_span)

  // BOTH channels are mandatory
  CHANNELS: [
    "@usdt_hub_payment_proof",[span_6](start_span)[span_6](end_span)
    "@usdt_g_ram[span_7](start_span)"[span_7](end_span)
  ],

  WELCOME_USDT: 0.01,[span_8](start_span)[span_8](end_span)

  // Ads
  AD_REWARD: 50,[span_9](start_span)[span_9](end_span)
  MONETAG_LIMIT: 30,[span_10](start_span)[span_10](end_span)
  ADSGRAM_LIMIT: 25,[span_11](start_span)[span_11](end_span)
  HILLTOP_LIMIT: 15,[span_12](start_span)[span_12](end_span)

  // Referral rewards
  REFERRAL_CHANNEL_JOIN: 200,[span_13](start_span)[span_13](end_span)
  REFERRAL_ADS_WATCHED: 300,[span_14](start_span)[span_14](end_span)

  // Tasks
  TASK_CREATE_COST: 100000,[span_15](start_span)[span_15](end_span)
  TASK_REWARD: 150,[span_16](start_span)[span_16](end_span)
  TASK_LIMIT: 500,[span_17](start_span)[span_17](end_span)

  // Withdraw
  WITHDRAW_MIN_POINTS: 10000,[span_18](start_span)[span_18](end_span)
  POINTS_PER_USDT: 100000,[span_19](start_span)[span_19](end_span)

  // Promo codes
  PROMO_CODES: [
    "USDTHUB2026",[span_20](start_span)[span_20](end_span)
    "MONDAYUSDT",[span_21](start_span)[span_21](end_span)
    "TUESDAYUSDT",[span_22](start_span)[span_22](end_span)
    "MONEYTIME",[span_23](start_span)[span_23](end_span)
    "CRYPTOBONUS",[span_24](start_span)[span_24](end_span)
    "BIRRGRAM2026",[span_25](start_span)[span_25](end_span)
    "FASTUSDT",[span_26](start_span)[span_26](end_span)
    "DAILYCLAIM",[span_27](start_span)[span_27](end_span)
    "LUCKYWIN",[span_28](start_span)[span_28](end_span)
    "REWARD777",[span_29](start_span)[span_29](end_span)
    "TELEGRAMVIP",[span_30](start_span)[span_30](end_span)
    "EARNMORE",[span_31](start_span)[span_31](end_span)
    "BINANCEHUB",[span_32](start_span)[span_32](end_span)
    "FREEUSDT200",[span_33](start_span)[span_33](end_span)
    "CLAIMNOW",[span_34](start_span)[span_34](end_span)
    "MEGAREWARD",[span_35](start_span)[span_35](end_span)
    "SUPERPAY",[span_36](start_span)[span_36](end_span)
    "BOOSTPOINTS",[span_37](start_span)[span_37](end_span)
    "STARTHUB",[span_38](start_span)[span_38](end_span)
    "GOLDENUSDT[span_39](start_span)"[span_39](end_span)
  ],

  PROMO_REWARD: 200,[span_40](start_span)[span_40](end_span)

  // Daily streak
  DAILY_STREAK_REWARDS: [
    50,[span_41](start_span)[span_41](end_span)
    75,[span_42](start_span)[span_42](end_span)
    100,[span_43](start_span)[span_43](end_span)
    150,[span_44](start_span)[span_44](end_span)
    200,[span_45](start_span)[span_45](end_span)
    300,[span_46](start_span)[span_46](end_span)
    500[span_47](start_span)[span_47](end_span)
  ],

  // BEP20 deposit address
  DEPOSIT_ADDRESS:
    process.env.DEPOSIT_RECEIVING_ADDRESS ||
    "0x55d398326f99059fF775485246999027B3197955",[span_48](start_span)[span_48](end_span)

  // VIP
  VIP_TIERS: {
    BRONZE: {
      name: "Bronze",[span_49](start_span)[span_49](end_span)
      minPts: 0,[span_50](start_span)[span_50](end_span)
      multiplier: 1.0[span_51](start_span)[span_51](end_span)
    },

    SILVER: {
      name: "Silver",[span_52](start_span)[span_52](end_span)
      minPts: 25000,[span_53](start_span)[span_53](end_span)
      multiplier: 1.15[span_54](start_span)[span_54](end_span)
    },

    GOLD: {
      name: "Gold",[span_55](start_span)[span_55](end_span)
      minPts: 75000,[span_56](start_span)[span_56](end_span)
      multiplier: 1.3[span_57](start_span)[span_57](end_span)
    },

    DIAMOND: {
      name: "Diamond",[span_58](start_span)[span_58](end_span)
      minPts: 200000,[span_59](start_span)[span_59](end_span)
      multiplier: 1.5[span_60](start_span)[span_60](end_span)
    }
  },

  // Referral contest
  CONTEST_PRIZES: {
    1: "$20.00",[span_61](start_span)[span_61](end_span)
    2: "$10.00",[span_62](start_span)[span_62](end_span)
    3: "$5.00[span_63](start_span)"[span_63](end_span)
  }
};
