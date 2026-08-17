import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    })
  });
}

const db = admin.firestore();

const REWARD = 200;

const PROMO_CODES = [
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
    const { telegramId, code } = req.body || {};

    if (!telegramId || !code) {
      return res.status(400).json({
        success: false,
        error: "Telegram ID and promo code are required"
      });
    }

    const cleanCode = String(code).trim().toUpperCase();

    if (!PROMO_CODES.includes(cleanCode)) {
      return res.status(400).json({
        success: false,
        error: "Invalid promo code"
      });
    }

    const userRef = db
      .collection("users")
      .doc(String(telegramId));

    const promoRef = db
      .collection("promoClaims")
      .doc(`${telegramId}_${cleanCode}`);

    let result;

    await db.runTransaction(async transaction => {
      const userSnap = await transaction.get(userRef);
      const promoSnap = await transaction.get(promoRef);

      if (!userSnap.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      if (promoSnap.exists) {
        throw new Error("ALREADY_CLAIMED");
      }

      const user = userSnap.data();
      const currentBalance = Number(user.balance || 0);

      const newBalance = currentBalance + REWARD;

      transaction.update(userRef, {
        balance: newBalance,
        promoPoints:
          admin.firestore.FieldValue.increment(REWARD),
        updatedAt:
          admin.firestore.FieldValue.serverTimestamp()
      });

      transaction.set(promoRef, {
        telegramId: String(telegramId),
        code: cleanCode,
        reward: REWARD,
        claimedAt:
          admin.firestore.FieldValue.serverTimestamp()
      });

      result = {
        reward: REWARD,
        balance: newBalance
      };
    });

    return res.status(200).json({
      success: true,
      message: "Promo code redeemed successfully",
      ...result
    });

  } catch (error) {
    console.error("PROMO ERROR:", error);

    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    if (error.message === "ALREADY_CLAIMED") {
      return res.status(409).json({
        success: false,
        error: "You already used this promo code"
      });
    }

    return res.status(500).json({
      success: false,
      error: "Promo code failed"
    });
  }
  }
