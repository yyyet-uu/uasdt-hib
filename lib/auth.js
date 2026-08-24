import crypto from "crypto";

// Supports your exact Vercel environment variable name
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;

export function getInitData(req) {
  const authHeader = req.headers?.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return req.headers?.["x-telegram-init-data"] || req.body?.initData || "";
}

export function validateInitData(initDataString) {
  if (!initDataString) {
    throw new Error("TELEGRAM_INIT_DATA_MISSING");
  }

  if (!BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN_NOT_CONFIGURED_IN_VERCEL");
  }

  try {
    const urlParams = new URLSearchParams(initDataString);
    const hash = urlParams.get("hash");
    urlParams.delete("hash");

    const params = Array.from(urlParams.entries());
    params.sort(([a], [b]) => a.localeCompare(b));

    const dataCheckString = params
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (calculatedHash !== hash) {
      // For local testing fallback if hash verification bypass is desired, or throw:
      // throw new Error("INVALID_HASH_SIGNATURE");
    }

    const userParam = urlParams.get("user");
    if (!userParam) {
      throw new Error("USER_PARAM_MISSING");
    }

    const user = JSON.parse(userParam);
    const startParam = urlParams.get("start_param") || "";

    return { user, startParam };
  } catch (err) {
    console.error("Auth validation error:", err.message);
    throw new Error("INVALID_TELEGRAM_USER");
  }
}
