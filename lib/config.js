function numberEnv(
  name,
  fallback
) {
  const value =
    Number(process.env[name]);

  return Number.isFinite(value)
    ? value
    : fallback;
}

export const CONFIG = {
  CHANNELS: [
    process.env.TELEGRAM_CHANNEL_1 ||
      "@birr_gram",

    process.env.TELEGRAM_CHANNEL_2 ||
      "@usdt_g_ram"
  ],

  WELCOME_USDT:
    numberEnv(
      "WELCOME_USDT",
      0.01
    ),

  AD_REWARD:
    numberEnv(
      "AD_REWARD",
      0.02
    ),

  MONETAG_LIMIT:
    numberEnv(
      "MONETAG_LIMIT",
      25
    ),

  ADSGRAM_LIMIT:
    numberEnv(
      "ADSGRAM_LIMIT",
      25
    ),

  REFERRAL_CHANNEL:
    numberEnv(
      "REFERRAL_CHANNEL",
      0.05
    ),

  REFERRAL_ADS:
    numberEnv(
      "REFERRAL_ADS",
      0.05
    ),

  PROMO_REWARD:
    numberEnv(
      "PROMO_REWARD",
      0.05
    ),

  TASK_CREATE_COST:
    numberEnv(
      "TASK_CREATE_COST",
      1
    ),

  TASK_REWARD:
    numberEnv(
      "TASK_REWARD",
      0.02
    ),

  TASK_LIMIT:
    numberEnv(
      "TASK_LIMIT",
      50
    ),

  WITHDRAW_MIN_POINTS:
    numberEnv(
      "WITHDRAW_MIN_POINTS",
      1
    ),

  POINTS_PER_USDT:
    numberEnv(
      "POINTS_PER_USDT",
      100
    )
};
