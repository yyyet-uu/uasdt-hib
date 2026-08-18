import { db, FieldValue } from "../lib/firebase.js";
import { validateInitData, getInitData } from "../lib/auth.js";
import { CONFIG } from "../lib/config.js";

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
    const provider =
      String(req.body.provider || "");

    if (!["monetag", "adsgram"].includes(provider)) {
      return res.status(400).json({
        success: false,
        error: "Invalid provider"
      });
    }

    const userRef =
      db.collection("users").doc(uid);

    const rewardRef =
      db.collection("adRewards").doc();

    let result;

    await db.runTransaction(async tx => {
      const snap =
        await tx.get(userRef);

      if (!snap.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      const u = snap.data();

      if (!u.channelsVerified) {
        throw new Error("CHANNELS_REQUIRED");
      }

      const today =
        new Date().toISOString().slice(0, 10);

      let monetagToday =
        Number(u.monetagToday || 0);

      let adsgramToday =
        Number(u.adsgramToday || 0);

      if (u.adDate !== today) {
        monetagToday = 0;
        adsgramToday = 0;
      }

      if (
        provider === "monetag" &&
        monetagToday >= CONFIG.MONETAG_LIMIT
      ) {
        throw new Error("MONETAG_LIMIT");
      }

      if (
        provider === "adsgram" &&
        adsgramToday >= CONFIG.ADSGRAM_LIMIT
      ) {
        throw new Error("ADSGRAM_LIMIT");
      }

      if (provider === "monetag") {
        monetagToday++;
      } else {
        adsgramToday++;
      }

      const updates = {
        balance:
          FieldValue.increment(CONFIG.AD_REWARD),

        adsWatched:
          FieldValue.increment(1),

        [`${provider}Ads`]:
          FieldValue.increment(1),

        monetagToday,
        adsgramToday,
        adDate: today,

        updatedAt:
          FieldValue.serverTimestamp()
      };

      tx.update(userRef, updates);

      tx.create(rewardRef, {
        userId: uid,
        provider,
        reward: CONFIG.AD_REWARD,
        date: today,
        createdAt:
          FieldValue.serverTimestamp()
      });

      result = {
        reward: CONFIG.AD_REWARD,
        monetagToday,
        adsgramToday
      };
    });

    return res.json({
      success: true,
      ...result
    });

  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
}
