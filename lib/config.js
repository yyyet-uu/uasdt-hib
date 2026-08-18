export const CONFIG = {
  CHANNELS: ["@birr_gram", "@usdt_g_ram"],

  POINTS_PER_USDT: 100000,

  WELCOME_USDT: 0.01,

  WITHDRAW_MIN_POINTS: 10000,

  AD_REWARD: 75,
  MONETAG_LIMIT: 25,
  ADSGRAM_LIMIT: 15,

  REFERRAL_TOTAL: 1000,
  REFERRAL_CHANNEL: 500,
  REFERRAL_ADS: 500,

  TASK_CREATE_COST: 100000,
  TASK_REWARD: 2000,
  TASK_LIMIT: 50,

  XO_LIMIT: 3,
  XO_ENTRY: 100,
  XO_WIN: 180,

  PROMO_REWARD: 200
};

export function required(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
      }
