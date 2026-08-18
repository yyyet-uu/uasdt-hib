import { db, FieldValue } from "../lib/firebase.js";
import { validateInitData, getInitData } from "../lib/auth.js";
import { CONFIG } from "../lib/config.js";

const CODES = [
  "USDTHUB",
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
];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const { user } =
      validateInitData(getInitData(req));

    const uid = String(user.id);

    const code =
      String(req.body.code || "")
        .trim()
        .toUpperCase();

    if (!CODES.includes(code)) {
      throw new Error("INVALID_CODE");
    }

    const claimRef =
      db.collection("promoClaims")
        .doc(`${uid}_${code}`);

    const userRef =
      db.collection("users").doc(uid);

    await db.runTransaction(async tx => {
      const claim =
        await tx.get(claimRef);

      const u =
        await tx.get(userRef);

      if (!u.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      if (claim.exists) {
        throw new Error("ALREADY_CLAIMED");
      }

      tx.create(claimRef, {
        userId: uid,
        code,
        reward: CONFIG.PROMO_REWARD,
        createdAt:
          FieldValue.serverTimestamp()
      });

      tx.update(userRef, {
        balance:
          FieldValue.increment(
            CONFIG.PROMO_REWARD
          )
      });
    });

    return res.json({
      success: true,
      reward: CONFIG.PROMO_REWARD
    });

  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
}
