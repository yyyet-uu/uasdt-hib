import crypto from "node:crypto";

function getRawInitData(req) {
  const header =
    req.headers?.["x-telegram-init-data"];

  if (header) {
    return String(header);
  }

  const authHeader =
    req.headers?.authorization;

  if (
    authHeader &&
    authHeader.startsWith("tma ")
  ) {
    return authHeader.slice(4);
  }

  return String(
    req.body?.initData ||
    req.query?.initData ||
    ""
  );
}

function parseInitData(initData) {
  const params =
    new URLSearchParams(initData);

  const userRaw =
    params.get("user");

  if (!userRaw) {
    throw new Error(
      "TELEGRAM_USER_MISSING"
    );
  }

  let user;

  try {
    user =
      JSON.parse(userRaw);
  } catch {
    throw new Error(
      "INVALID_TELEGRAM_USER"
    );
  }

  return {
    params,
    user,
    startParam:
      params.get("start_param") ||
      ""
  };
}

export function validateInitData(
  initData
) {
  if (!initData) {
    throw new Error(
      "TELEGRAM_INIT_DATA_REQUIRED"
    );
  }

  const params =
    new URLSearchParams(initData);

  const receivedHash =
    params.get("hash");

  if (!receivedHash) {
    throw new Error(
      "TELEGRAM_HASH_MISSING"
    );
  }

  params.delete("hash");

  const dataCheckString =
    [...params.entries()]
      .sort(
        ([a], [b]) =>
          a.localeCompare(b)
      )
      .map(
        ([key, value]) =>
          `${key}=${value}`
      )
      .join("\n");

  const botToken =
    process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN_MISSING"
    );
  }

  const secretKey =
    crypto
      .createHmac(
        "sha256",
        "WebAppData"
      )
      .update(botToken)
      .digest();

  const calculatedHash =
    crypto
      .createHmac(
        "sha256",
        secretKey
      )
      .update(dataCheckString)
      .digest("hex");

  const received =
    Buffer.from(
      receivedHash,
      "hex"
    );

  const calculated =
    Buffer.from(
      calculatedHash,
      "hex"
    );

  if (
    received.length !==
    calculated.length ||
    !crypto.timingSafeEqual(
      received,
      calculated
    )
  ) {
    throw new Error(
      "INVALID_TELEGRAM_INIT_DATA"
    );
  }

  const parsed =
    parseInitData(initData);

  return parsed;
}

export function getInitData(req) {
  return getRawInitData(req);
}
