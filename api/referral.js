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
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const REFERRAL_TOTAL = 1000;
const CHANNEL_REWARD = 500;
const ADS_REWARD = 500;

async function sendTelegram(chatId, text) {
  if (!BOT_TOKEN || !chatId) return;

  await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: String(chatId),
        text
      })
    }
  );
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
      action,
      telegramId,
      referralCode,
      referredUserId
    } = req.body || {};

    if (!telegramId) {
      return res.status(400).json({
        success: false,
        error: "Telegram ID is required"
      });
    }

    const userRef = db
      .collection("users")
      .doc(String(telegramId));

    /* CREATE / GET REFERRAL LINK */

    if (action === "getLink") {
      const snap = await userRef.get();

      if (!snap.exists) {
        return res.status(404).json({
          success: false,
          error: "User not found"
        });
      }

      const user = snap.data();

      const code =
        user.referralCode || `ref_${telegramId}`;

      if (!user.referralCode) {
        await userRef.set(
          {
            referralCode: code,
            updatedAt:
              admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      }

      return res.status(200).json({
        success: true,
        referralCode: code,
        referralLink:
          `https://t.me/Ussdt_hub_bot?start=${code}`
      });
    }

    /* REGISTER REFERRAL */

    if (action === "register") {
      if (!referralCode || !referredUserId) {
        return res.status(400).json({
          success: false,
          error: "Referral information is required"
        });
      }

      const referredId = String(referredUserId);
      const inviterCode = String(referralCode);

      const inviterQuery = await db
        .collection("users")
        .where("referralCode", "==", inviterCode)
        .limit(1)
        .get();

      if (inviterQuery.empty) {
        return res.status(404).json({
          success: false,
          error: "Referral code not found"
        });
      }

      const inviterRef = inviterQuery.docs[0].ref;

      if (inviterRef.id === referredId) {
        return res.status(400).json({
          success: false,
          error: "Self referral is not allowed"
        });
      }

      const referredRef = db
        .collection("users")
        .doc(referredId);

      await db.runTransaction(async transaction => {
        const referredSnap =
          await transaction.get(referredRef);

        if (!referredSnap.exists) {
          throw new Error("REFERRED_USER_NOT_FOUND");
        }

        const referred = referredSnap.data();

        if (referred.referredBy) {
          return;
        }

        transaction.update(referredRef, {
          referredBy: inviterRef.id,
          referralRegistered: true,
          referralChannelRewarded: false,
          referralAdsRewarded: false,
          updatedAt:
            admin.firestore.FieldValue.serverTimestamp()
        });

        const referralRef = db
          .collection("referrals")
          .doc();

        transaction.set(referralRef, {
          inviterId: inviterRef.id,
          referredUserId: referredId,
          channelReward: CHANNEL_REWARD,
          adsReward: ADS_REWARD,
          totalReward: REFERRAL_TOTAL,
          channelRewarded: false,
          adsRewarded: false,
          createdAt:
            admin.firestore.FieldValue.serverTimestamp()
        });
      });

      await sendTelegram(
        inviterRef.id,
        `🎉 New referral!

A user joined using your referral link.

You can earn up to 1,000 points:
• 500 points after channel verification
• 500 points after the user watches 2 ads.`
      );

      return res.status(200).json({
        success: true,
        message: "Referral registered"
      });
    }

    /* GET REFERRAL LIST */

    if (action === "list") {
      const snap = await db
        .collection("referrals")
        .where("inviterId", "==", String(telegramId))
        .get();

      const referrals = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      const total = referrals.length;

      const earned = referrals.reduce(
        (sum, r) =>
          sum +
          (r.channelRewarded ? CHANNEL_REWARD : 0) +
          (r.adsRewarded ? ADS_REWARD : 0),
        0
      );

      return res.status(200).json({
        success: true,
        total,
        earned,
        referrals
      });
    }

    /* REWARD CHANNEL JOIN */

    if (action === "channelReward") {
      const referralSnap = await db
        .collection("referrals")
        .where(
          "referredUserId",
          "==",
          String(referredUserId)
        )
        .where(
          "inviterId",
          "==",
          String(telegramId)
        )
        .limit(1)
        .get();

      if (referralSnap.empty) {
        return res.status(404).json({
          success: false,
          error: "Referral not found"
        });
      }

      const referralRef = referralSnap.docs[0].ref;

      await db.runTransaction(async transaction => {
        const referralDoc =
          await transaction.get(referralRef);

        const referral = referralDoc.data();

        if (referral.channelRewarded) return;

        const inviterRef = db
          .collection("users")
          .doc(String(telegramId));

        transaction.update(inviterRef, {
          balance:
            admin.firestore.FieldValue.increment(
              CHANNEL_REWARD
            ),
          referralPoints:
            admin.firestore.FieldValue.increment(
              CHANNEL_REWARD
            )
        });

        transaction.update(referralRef, {
          channelRewarded: true,
          channelRewardedAt:
            admin.firestore.FieldValue.serverTimestamp()
        });
      });

      return res.status(200).json({
        success: true,
        reward: CHANNEL_REWARD
      });
    }

    /* REWARD AFTER 2 ADS */

    if (action === "adsReward") {
      const referralSnap = await db
        .collection("referrals")
        .where(
          "referredUserId",
          "==",
          String(referredUserId)
        )
        .where(
          "inviterId",
          "==",
          String(telegramId)
        )
        .limit(1)
        .get();

      if (referralSnap.empty) {
        return res.status(404).json({
          success: false,
          error: "Referral not found"
        });
      }

      const referralRef = referralSnap.docs[0].ref;

      await db.runTransaction(async transaction => {
        const referralDoc =
          await transaction.get(referralRef);

        const referral = referralDoc.data();

        if (referral.adsRewarded) return;

        const referredRef = db
          .collection("users")
          .doc(String(referredUserId));

        const referredSnap =
          await transaction.get(referredRef);

        if (!referredSnap.exists) {
          throw new Error("REFERRED_USER_NOT_FOUND");
        }

        const referred = referredSnap.data();

        const adsWatched =
          Number(referred.adsWatched || 0);

        if (adsWatched < 2) {
          throw new Error("TWO_ADS_REQUIRED");
        }

        const inviterRef = db
          .collection("users")
          .doc(String(telegramId));

        transaction.update(inviterRef, {
          balance:
            admin.firestore.FieldValue.increment(
              ADS_REWARD
            ),
          referralPoints:
            admin.firestore.FieldValue.increment(
              ADS_REWARD
            )
        });

        transaction.update(referralRef, {
          adsRewarded: true,
          adsRewardedAt:
            admin.firestore.FieldValue.serverTimestamp()
        });
      });

      return res.status(200).json({
        success: true,
        reward: ADS_REWARD
      });
    }

    return res.status(400).json({
      success: false,
      error: "Unknown referral action"
    });

  } catch (error) {
    console.error("REFERRAL ERROR:", error);

    if (error.message === "TWO_ADS_REQUIRED") {
      return res.status(400).json({
        success: false,
        error: "Referred user must watch 2 ads first"
      });
    }

    return res.status(500).json({
      success: false,
      error: "Referral operation failed"
    });
  }
  }
