import crypto from "crypto";
import { CONFIG } from "./config.js";

// =====================================================
// EXTRACT INIT DATA FROM REQUEST
// =====================================================

export function getInitData(req) {
  const header =
    req.headers?.["x-telegram-init-data"] ||
    req.headers?.["X-Telegram-Init-Data"] ||
    req.body?.initData ||
    req.query?.initData ||
    "";

  if (!header) {
    throw new Error("TELEGRAM_INIT_DATA_REQUIRED");
  }

  return String(header);
}

// =====================================================
// VALIDATE TELEGRAM HMAC-SHA256 SIGNATURE
// =====================================================

export function validateInitData(initData) {
  if (!initData) {
    throw new Error("TELEGRAM_INIT_DATA_REQUIRED");
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) {
    throw new Error("INVALID_TELEGRAM_DATA");
  }

  // Remove hash before building verification string
  params.delete("hash");

  // Sort remaining parameters alphabetically
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const botToken = CONFIG.BOT_TOKEN;
  if (!botToken) {
    throw new Error("BOT_TOKEN_NOT_CONFIGURED");
  }

  // Telegram WebApp Secret Key generation: HMAC_SHA256("WebAppData", botToken)
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  // Calculate HMAC-SHA256 hash of dataCheckString using secretKey
  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // Constant-time comparison against timing attacks
  const calculatedBuffer = Buffer.from(calculatedHash, "hex");
  const receivedBuffer = Buffer.from(hash, "hex");

  if (
    calculatedBuffer.length !== receivedBuffer.length ||
    !crypto.timingSafeEqual(calculatedBuffer, receivedBuffer)
  ) {
    throw new Error("INVALID_TELEGRAM_SIGNATURE");
  }

  // Check auth_date expiration
  const authDate = Number(params.get("auth_date") || 0);
  const maxAge = Number(CONFIG.INIT_DATA_MAX_AGE || 86400);

  if (
    !authDate ||
    Math.floor(Date.now() / 1000) - authDate > maxAge
  ) {
    throw new Error("TELEGRAM_DATA_EXPIRED");
  }

  // Parse Telegram User object
  const userRaw = params.get("user");
  if (!userRaw) {
    throw new Error("TELEGRAM_USER_MISSING");
  }

  let user;
  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new Error("INVALID_TELEGRAM_USER_JSON");
  }

  if (!user?.id) {
    throw new Error("TELEGRAM_USER_ID_MISSING");
  }

  // Extract startParam (supports both start_param and tgWebAppStartParam)
  const startParam =
    params.get("start_param") ||
    params.get("tgWebAppStartParam") ||
    "";

  return {
    user,
    startParam,
    authDate,
    queryId: params.get("query_id") || null
  };
}
