import crypto from "node:crypto";

const MAX_AGE = 24 * 60 * 60;

export function getInitData(req) {
  return (
    req.body?.initData ||
    req.headers["x-telegram-init-data"] ||
    ""
  );
}

export function validateInitData(initData) {
  if (!initData) {
    throw new Error("MISSING_INIT_DATA");
  }

  const params = new URLSearchParams(initData);

  const receivedHash = params.get("hash");

  if (!receivedHash) {
    throw new Error("INVALID_INIT_DATA");
  }

  params.delete("hash");
  params.delete("signature");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(process.env.TELEGRAM_BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const a = Buffer.from(calculatedHash, "hex");
  const b = Buffer.from(receivedHash, "hex");

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {
    throw new Error("INVALID_INIT_DATA");
  }

  const authDate = Number(params.get("auth_date"));

  if (
    !authDate ||
    Math.floor(Date.now() / 1000) - authDate > MAX_AGE
  ) {
    throw new Error("EXPIRED_INIT_DATA");
  }

  const userRaw = params.get("user");

  if (!userRaw) {
    throw new Error("USER_MISSING");
  }

  const user = JSON.parse(userRaw);

  return {
    user,
    startParam: params.get("start_param") || ""
  };
}
