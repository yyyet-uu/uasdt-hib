import { db, FieldValue } from "../lib/firebase.js";
import { validateInitData, getInitData } from "../lib/auth.js";
import { CONFIG } from "../lib/config.js";

function isPostback(req) {
  return Boolean(
    req.query?.telegram_id &&
    req.query?.ymid
  );
}

async function monetagPostback(req, res) {
  try {
    const {
      telegram_id,
      ymid,
      reward_event_type,
      zone_id
    } = req.query;

    if (!telegram_id || !ymid) {
      return res.status(400).send("missing");
    }

    if (
      process.env.MONETAG_POSTBACK_SECRET &&
      req.query.secret !==
        process.env.MONETAG_POSTBACK_SECRET
    ) {
      return res.status(403).send("forbidden");
    }

    if (
      reward_event_type &&
      reward_event_type !== "valued"
    ) {
      return res.status(200).send("ignored");
    }

    const eventId =
      `monetag_${ymid}_${zone_id || "default"}`;

    const eventRef =
      db.collection("monetagEvents")
        .doc(eventId);

    const userRef =
      db.collection("users")
        .doc(String(telegram_id));

    await db.runTransaction(async tx => {
      const oldEvent =
        await tx.get(eventRef);

      // Prevent duplicate Monetag callbacks.
      if (oldEvent.exists) return;

      const user =
        await tx.get(userRef);

      if (!user.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      tx.create(eventRef, {
        userId: String(telegram_id),
        ymid,
        zoneId: zone_id || null,
        reward: CONFIG.AD_REWARD,
        createdAt:
          FieldValue.serverTimestamp()
      });

      tx.update(userRef, {
        balance:
          FieldValue.increment(
            CONFIG.AD_REWARD
          ),

        adsWatched:
          FieldValue.increment(1),

        monetagAds:
          FieldValue.increment(1),

        updatedAt:
          FieldValue.serverTimestamp()
      });
    });

    return res.status(200).send("ok");

  } catch (error) {
    console.error(
      "MONETAG POSTBACK:",
      error
    );

    return res.status(400).send("error");
  }
}

async function rewardAd(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  const { user } =
    validateInitData(
      getInitData(req)
    );

  const uid = String(user.id);

  const provider =
    String(req.body?.provider || "");

  if (
    !["monetag", "adsgram"]
      .includes(provider)
  ) {
    return res.status(400).json({
      success: false,
      error: "INVALID_PROVIDER"
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
      throw new Error(
        "CHANNELS_REQUIRED"
      );
    }

    const today =
      new Date()
        .toISOString()
        .slice(0, 10);

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
      monetagToday >=
        CONFIG.MONETAG_LIMIT
    ) {
      throw new Error(
        "MONETAG_LIMIT"
      );
    }

    if (
      provider === "adsgram" &&
      adsgramToday >=
        CONFIG.ADSGRAM_LIMIT
    ) {
      throw new Error(
        "ADSGRAM_LIMIT"
      );
    }

    if (provider === "monetag") {
      monetagToday++;
    } else {
      adsgramToday++;
    }

    tx.update(userRef, {
      balance:
        FieldValue.increment(
          CONFIG.AD_REWARD
        ),

      adsWatched:
        FieldValue.increment(1),

      [`${provider}Ads`]:
        FieldValue.increment(1),

      monetagToday,
      adsgramToday,
      adDate: today,

      updatedAt:
        FieldValue.serverTimestamp()
    });

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
}

export default async function handler(
  req,
  res
) {
  try {
    // Monetag calls this endpoint using
    // query parameters, not Telegram initData.
    if (isPostback(req)) {
      return await monetagPostback(
        req,
        res
      );
    }

    return await rewardAd(
      req,
      res
    );

  } catch (error) {
    console.error(
      "ADS API:",
      error
    );

    return res.status(400).json({
      success: false,
      error:
        error.message ||
        "Ad request failed"
    });
  }
      }
