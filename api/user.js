import { db, FieldValue } from "../lib/firebase.js";
import { validateInitData, getInitData } from "../lib/auth.js";
import { sendMessage } from "../lib/telegram.js";

function referralId(inviter, user) {
  return `${inviter}_${user}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const { user, startParam } =
      validateInitData(getInitData(req));

    const uid = String(user.id);

    const ref = db.collection("users").doc(uid);
    const existing = await ref.get();

    if (existing.exists) {
      return res.json({
        success: true,
        newUser: false,
        user: existing.data()
      });
    }

    let inviterId = null;

    if (startParam?.startsWith("ref_")) {
      const possible =
        startParam.slice(4);

      if (
        possible &&
        possible !== uid
      ) {
        const inviterRef =
          db.collection("users").doc(possible);

        const inviter =
          await inviterRef.get();

        if (inviter.exists) {
          inviterId = possible;
        }
      }
    }

    const userData = {
      telegramId: uid,
      firstName: user.first_name || "",
      lastName: user.last_name || "",
      username: user.username || "",

      balance: 0,

      adsWatched: 0,
      monetagAds: 0,
      adsgramAds: 0,
      monetagToday: 0,
      adsgramToday: 0,
      adDate: null,

      tasksCompleted: 0,

      referrals: 0,
      referralPoints: 0,

      welcomeBonusClaimed: false,
      welcomeBonusStatus: "none",
      welcomeAddress: null,

      channelsVerified: false,
      appUnlocked: false,

      xoDailyPlays: 0,
      xoPlayDate: null,
      xoPlays: 0,
      xoWins: 0,

      aviatorGames: 0,
      aviatorWins: 0,

      referralCode: `ref_${uid}`,

      referredBy: inviterId,

      createdAt:
        FieldValue.serverTimestamp(),

      updatedAt:
        FieldValue.serverTimestamp()
    };

    const referralRef =
      inviterId
        ? db.collection("referrals")
          .doc(referralId(inviterId, uid))
        : null;

    const batch = db.batch();

    batch.create(ref, userData);

    if (referralRef) {
      batch.create(referralRef, {
        inviterId,
        referredUserId: uid,

        channelReward: 500,
        adsReward: 500,

        channelRewarded: false,
        adsRewarded: false,

        createdAt:
          FieldValue.serverTimestamp()
      });

      batch.update(
        db.collection("users").doc(inviterId),
        {
          referrals:
            FieldValue.increment(1)
        }
      );
    }

    await batch.commit();

    try {
      await sendMessage(
        uid,
        "🎉 <b>Welcome to USDT Hub!</b>\n\nYour account has been created successfully."
      );

      if (inviterId) {
        await sendMessage(
          inviterId,
          "👥 <b>New referral!</b>\nSomeone registered using your referral link."
        );
      }
    } catch {}

    return res.status(201).json({
      success: true,
      newUser: true,
      user: userData
    });

  } catch (error) {
    console.error(error);

    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
}
