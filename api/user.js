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
      firstName = "",
      username = "",
      referralCode = ""
    } = req.body || {};

    if (!telegramId) {
      return res.status(400).json({
        success: false,
        error: "Telegram ID is required"
      });
    }

    const userRef =
      db.collection("users").doc(String(telegramId));

    const snapshot = await userRef.get();

    if (snapshot.exists) {

      const user = snapshot.data();

      return res.status(200).json({
        success: true,
        existingUser: true,
        user
      });
    }

    const user = {

      telegramId: String(telegramId),

      firstName,
      username,

      balance: 0,

      adsWatched: 0,

      monetagAds: 0,
      adsgramAds: 0,

      tasksCompleted: 0,

      referrals: 0,
      referralPoints: 0,

      withdrawals: 0,

      xoPlays: 0,

      welcomeBonusClaimed: false,

      welcomeAddress: null,

      channelsVerified: false,

      referralCode:
        `ref_${String(telegramId)}`,

      referredBy:
        referralCode || null,

      createdAt:
        admin.firestore.FieldValue.serverTimestamp(),

      updatedAt:
        admin.firestore.FieldValue.serverTimestamp()
    };

    await userRef.set(user);

    return res.status(200).json({
      success: true,
      existingUser: false,
      user
    });

  } catch (error) {

    console.error("USER API ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
      }
