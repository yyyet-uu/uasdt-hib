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

const REWARD = 75;
const LIMITS = {
  monetag: 25,
  adsgram: 15
};

function todayKey() {
  const now = new Date();

  return [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0")
  ].join("-");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const {
      telegramId,
      provider
    } = req.body || {};

    if (!telegramId || !provider) {
      return res.status(400).json({
        success: false,
        error: "telegramId and provider are required"
      });
    }

    if (!["monetag", "adsgram"].includes(provider)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ad provider"
      });
    }

    const userRef = db
      .collection("users")
      .doc(String(telegramId));

    let result;

    await db.runTransaction(async transaction => {
      const snap = await transaction.get(userRef);

      if (!snap.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      const user = snap.data();
      const today = todayKey();

      let adDate = user.adDate || today;
      let monetagToday = Number(user.monetagToday || 0);
      let adsgramToday = Number(user.adsgramToday || 0);

      if (adDate !== today) {
        adDate = today;
        monetagToday = 0;
        adsgramToday = 0;
      }

      if (
        provider === "monetag" &&
        monetagToday >= LIMITS.monetag
      ) {
        throw new Error("MONETAG_LIMIT");
      }

      if (
        provider === "adsgram" &&
        adsgramToday >= LIMITS.adsgram
      ) {
        throw new Error("ADSGRAM_LIMIT");
      }

      if (provider === "monetag") {
        monetagToday++;
      } else {
        adsgramToday++;
      }

      const totalAds =
        monetagToday + adsgramToday;

      const newBalance =
        Number(user.balance || 0) + REWARD;

      transaction.update(userRef, {
        balance: newBalance,

        adsWatched:
          admin.firestore.FieldValue.increment(1),

        [`${provider}Ads`]:
          admin.firestore.FieldValue.increment(1),

        monetagToday,
        adsgramToday,
        adDate: today,

        updatedAt:
          admin.firestore.FieldValue.serverTimestamp()
      });

      const adRef = db.collection("adRewards").doc();

      transaction.set(adRef, {
        telegramId: String(telegramId),
        provider,
        reward: REWARD,
        date: today,
        createdAt:
          admin.firestore.FieldValue.serverTimestamp()
      });

      result = {
        balance: newBalance,
        reward: REWARD,
        provider,
        monetagToday,
        monetagLimit: LIMITS.monetag,
        adsgramToday,
        adsgramLimit: LIMITS.adsgram,
        totalAds
      };
    });

    return res.status(200).json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error("ADS ERROR:", error);

    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    if (error.message === "MONETAG_LIMIT") {
      return res.status(429).json({
        success: false,
        error: "Monetag daily limit reached",
        limit: LIMITS.monetag
      });
    }

    if (error.message === "ADSGRAM_LIMIT") {
      return res.status(429).json({
        success: false,
        error: "Adsgram daily limit reached",
        limit: LIMITS.adsgram
      });
    }

    return res.status(500).json({
      success: false,
      error: "Unable to process ad reward"
    });
  }
      }
