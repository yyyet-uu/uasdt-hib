import crypto from "crypto";
import { CONFIG } from "./config.js";

function getInitData(req) {
  const header =
    req.headers?.["x-telegram-init-data"] ||
    req.headers?.["X-Telegram-Init-Data"] ||
    req.body?.initData ||
    "";

  if (!header) {
    throw new Error("TELEGRAM_INIT_DATA_REQUIRED");
  }

  return String(header);
}

function validateInitData(initData) {
  if (!initData) {
    throw new Error("TELEGRAM_INIT_DATA_REQUIRED");
  }

  const params = new URLSearchParams(initData);

  const hash = params.get("hash");

  if (!hash) {
    throw new Error("INVALID_TELEGRAM_DATA");
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const botToken = CONFIG.BOT_TOKEN;

  if (!botToken) {
    throw new Error("BOT_TOKEN_NOT_CONFIGURED");
  }

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (
    !crypto.timingSafeEqual(
      Buffer.from(calculatedHash, "hex"),
      Buffer.from(hash, "hex")
    )
  ) {
    throw new Error("INVALID_TELEGRAM_DATA");
  }

  const authDate = Number(
    params.get("auth_date") || 0
  );

  const maxAge =
    Number(CONFIG.INIT_DATA_MAX_AGE || 86400);

  if (
    !authDate ||
    Math.floor(Date.now() / 1000) - authDate >
      maxAge
  ) {
    throw new Error("TELEGRAM_DATA_EXPIRED");
  }

  const userRaw = params.get("user");

  if (!userRaw) {
    throw new Error("TELEGRAM_USER_MISSING");
  }

  let user;

  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new Error("INVALID_TELEGRAM_USER");
  }

  if (!user?.id) {
    throw new Error("TELEGRAM_USER_MISSING");
  }

  return {
    user,
    startParam:
      params.get("start_param") || ""
  };
}

export {
  getInitData,
  validateInitData
};
