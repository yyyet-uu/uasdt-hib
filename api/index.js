import { db, FieldValue } from "../lib/firebase.js";
import { validateInitData, getInitData } from "../lib/auth.js";
import { getChatMember, sendMessage } from "../lib/telegram.js";
import { sendUSDT } from "../lib/payout.js";
import { CONFIG } from "../lib/config.js";
import { ethers } from "ethers";

function isMember(member) {
  return ["member", "administrator", "creator"].includes(member.status);
}

function getAction(req) {
  return (
    req.query?.action ||
    req.body?.action ||
    ""
  ).toLowerCase();
}

async function register(req, res) {
  const { user, startParam } = validateInitData(getInitData(req));
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
    const possible = startParam.slice(4);

    if (possible && possible !== uid) {
      const inviter = await db
        .collection("users")
        .doc(possible)
        .get();

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

    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  const batch = db.batch();

  batch.create(ref, userData);

  if (inviterId) {
    const referralRef = db
      .collection("referrals")
      .doc(`${inviterId}_${uid}`);

    batch.create(referralRef, {
      inviterId,
      referredUserId: uid,

      channelReward: CONFIG.REFERRAL_CHANNEL,
      adsReward: CONFIG.REFERRAL_ADS,

      channelRewarded: false,
      adsRewarded: false,

      createdAt: FieldValue.serverTimestamp()
    });

    batch.update(
      db.collection("users").doc(inviterId),
      {
        referrals: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp()
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
}

async function verifyMembership(req, res) {
  const { user } = validateInitData(getInitData(req));
  const uid = String(user.id);

  const results = await Promise.all(
    CONFIG.CHANNELS.map(channel =>
      getChatMember(channel, uid)
    )
  );

  const joined = results.every(isMember);

  if (!joined) {
    return res.json({
      success: true,
      joined: false
    });
  }

  await db.collection("users").doc(uid).update({
    channelsVerified: true,
    updatedAt: FieldValue.serverTimestamp()
  });

  return res.json({
    success: true,
    joined: true
  });
}

async function claimWelcome(req, res) {
  const { user } = validateInitData(getInitData(req));
  const uid = String(user.id);

  const address = String(
    req.body?.address || ""
  ).trim();

  if (!ethers.isAddress(address)) {
    return res.status(400).json({
      success: false,
      error: "INVALID_ADDRESS"
    });
  }

  const normalized = ethers.getAddress(address);

  const userRef = db.collection("users").doc(uid);

  const addressRef = db
    .collection("welcomeClaims")
    .doc(normalized.toLowerCase());

  const payoutRef = db
    .collection("payouts")
    .doc();

  await db.runTransaction(async tx => {
    const userSnap = await tx.get(userRef);
    const addressSnap = await tx.get(addressRef);

    if (!userSnap.exists) {
      throw new Error("USER_NOT_FOUND");
    }

    const u = userSnap.data();

    if (!u.channelsVerified) {
      throw new Error("CHANNELS_REQUIRED");
    }

    if (u.welcomeBonusClaimed) {
      throw new Error("WELCOME_ALREADY_CLAIMED");
    }

    if (addressSnap.exists) {
      throw new Error("ADDRESS_ALREADY_USED");
    }

    tx.set(addressRef, {
      userId: uid,
      address: normalized,
      payoutId: payoutRef.id,
      createdAt: FieldValue.serverTimestamp()
    });

    tx.set(payoutRef, {
      type: "welcome",
      userId: uid,
      address: normalized,
      amount: CONFIG.WELCOME_USDT,
      status: "processing",
      createdAt: FieldValue.serverTimestamp()
    });

    tx.update(userRef, {
      welcomeBonusClaimed: true,
      welcomeBonusStatus: "processing",
      welcomeAddress: normalized,
      appUnlocked: true,
      updatedAt: FieldValue.serverTimestamp()
    });
  });

  try {
    const payment = await sendUSDT(
      normalized,
      CONFIG.WELCOME_USDT
    );

    await payoutRef.update({
      status: "paid",
      txHash: payment.txHash,
      paidAt: FieldValue.serverTimestamp()
    });

    await userRef.update({
      welcomeBonusStatus: "paid",
      updatedAt: FieldValue.serverTimestamp()
    });

    try {
      await sendMessage(
        uid,
        `🎁 <b>Welcome bonus sent!</b>\n\n💰 ${CONFIG.WELCOME_USDT} USDT\n🔗 ${payment.txHash}`
      );
    } catch {}

    return res.json({
      success: true,
      amount: CONFIG.WELCOME_USDT,
      txHash: payment.txHash
    });

  } catch (error) {
    await payoutRef.update({
      status: "failed",
      error: error.message,
      updatedAt: FieldValue.serverTimestamp()
    });

    await userRef.update({
      welcomeBonusStatus: "failed",
      updatedAt: FieldValue.serverTimestamp()
    });

    throw error;
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const action = getAction(req);

    switch (action) {
      case "user":
        return await register(req, res);

      case "verify-membership":
        return await verifyMembership(req, res);

      case "claim-welcome":
        return await claimWelcome(req, res);

      default:
        return res.status(404).json({
          success: false,
          error: "Unknown API action"
        });
    }

  } catch (error) {
    console.error("USDT HUB API:", error);

    return res.status(400).json({
      success: false,
      error: error.message || "Request failed"
    });
  }
}
