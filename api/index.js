import crypto from "crypto";
import { ethers } from "ethers";
import { db, FieldValue } from "../lib/firebase.js";
import { validateInitData, getInitData } from "../lib/auth.js";
import {
  getChatMember,
  sendMessage,
  broadcastPaymentProof,
  notifyNewReferral,
  notifyReferralBonus,
  notifyWithdrawalSuccess,
  notifyWelcomeBonus
} from "../lib/telegram.js";
import { sendUSDT, getPayoutWalletInfo } from "../lib/payout.js";
import { CONFIG } from "../lib/config.js";

function getPath(req) {
  const rawUrl = String(req.url || "");
  return rawUrl.split("?")[0].replace(/\/+$/, "") || "/";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function memberOK(member) {
  return ["member", "administrator", "creator"].includes(member?.status);
}

function getUser(req) {
  const initData = getInitData(req);
  if (!initData) throw new Error("TELEGRAM_INIT_DATA_MISSING");

  const result = validateInitData(initData);
  if (!result?.user) throw new Error("INVALID_TELEGRAM_USER");

  return result;
}

function getVipTier(totalPts = 0) {
  const tiers = Object.values(CONFIG.VIP_TIERS).sort((a, b) => b.minPts - a.minPts);
  for (const tier of tiers) {
    if (totalPts >= tier.minPts) return tier;
  }
  return CONFIG.VIP_TIERS.BRONZE;
}

function calculateRoundCrash(roundIndex) {
  const hash = crypto
    .createHmac("sha256", CONFIG.AVIATOR_SERVER_SECRET || "USDT_HUB_SECRET_KEY_999")
    .update(String(roundIndex))
    .digest("hex");

  const rand = parseInt(hash.slice(0, 8), 16) / 0xffffffff;
  const cycle = roundIndex % 5;

  if (cycle === 0) {
    if (rand < 0.52) return Number((1.01 + rand * 0.23).toFixed(2));
    if (rand < 0.88) return Number((1.25 + (rand - 0.52) * 2.8).toFixed(2));
    return Number((2.40 + (rand - 0.88) * 15.0).toFixed(2));
  } else if (cycle === 1 || cycle === 3) {
    if (rand < 0.48) return Number((1.00 + rand * 0.25).toFixed(2));
    if (rand < 0.84) return Number((1.26 + (rand - 0.48) * 3.2).toFixed(2));
    if (rand < 0.96) return Number((3.00 + (rand - 0.84) * 25.0).toFixed(2));
    return Number((7.00 + (rand - 0.96) * 120.0).toFixed(2));
  } else {
    if (rand < 0.54) return Number((1.02 + rand * 0.20).toFixed(2));
    if (rand < 0.86) return Number((1.24 + (rand - 0.54) * 2.6).toFixed(2));
    return Number((2.20 + (rand - 0.86) * 35.0).toFixed(2));
  }
}

function getLiveAviatorState(timestamp = Date.now()) {
  const epochMs = timestamp;
  const roundDuration = 16000;
  const roundIndex = Math.floor(epochMs / roundDuration);
  const msInRound = epochMs % roundDuration;

  const crashMultiplier = calculateRoundCrash(roundIndex);
  const flyTimeMs = Math.min(8500, Math.max(2200, Math.log(crashMultiplier + 1) * 3600));
  const bettingDuration = 5000;

  let phase;
  let currentMultiplier = 1.00;

  if (msInRound < bettingDuration) {
    phase = "BETTING";
  } else if (msInRound < bettingDuration + flyTimeMs) {
    phase = "FLYING";
    const progress = (msInRound - bettingDuration) / flyTimeMs;
    currentMultiplier = Math.min(
      crashMultiplier,
      Math.max(1.00, 1.00 + (crashMultiplier - 1.00) * Math.pow(progress, 1.75))
    );
  } else {
    phase = "CRASHED";
    currentMultiplier = crashMultiplier;
  }

  const history = [];
  for (let i = 1; i <= 8; i++) {
    history.push(calculateRoundCrash(roundIndex - i));
  }

  return {
    roundIndex,
    phase,
    crashMultiplier: Number(crashMultiplier.toFixed(2)),
    currentMultiplier: Number(currentMultiplier.toFixed(2)),
    msInRound,
    flyTimeMs,
    history
  };
}

async function userHandler(req, res) {
  let { user, startParam } = getUser(req);
  const uid = String(user.id);

  if (!startParam && req.body?.startParam) {
    startParam = String(req.body.startParam).trim();
  }

  const userRef = db.collection("users").doc(uid);
  const existing = await userRef.get();

  if (existing.exists) {
    const userData = existing.data();
    const vip = getVipTier(userData.balance || 0);

    return res.status(200).json({
      success: true,
      newUser: false,
      user: {
        ...userData,
        vipTier: vip.name,
        vipMultiplier: vip.multiplier,
        botUsername: CONFIG.BOT_USERNAME,
        isAdmin: uid === String(CONFIG.ADMIN_ID)
      }
    });
  }

  let inviterId = null;
  if (startParam && String(startParam).startsWith("ref_")) {
    const possible = String(startParam).slice(4).trim();
    if (possible && possible !== uid) {
      const inviterDoc = await db.collection("users").doc(possible).get();
      if (inviterDoc.exists) {
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
    hilltopAds: 0,
    monetagToday: 0,
    adsgramToday: 0,
    hilltopToday: 0,
    adDate: null,
    tasksCompleted: 0,
    referrals: 0,
    referralPoints: 0,
    welcomeBonusClaimed: false,
    welcomeBonusStatus: "none",
    welcomeAddress: null,
    channelsVerified: false,
    appUnlocked: false,
    streakDay: 0,
    lastStreakDate: null,
    aviatorGames: 0,
    aviatorWins: 0,
    withdrawals: 0,
    lastWithdrawalId: null,
    referralCode: `ref_${uid}`,
    referredBy: inviterId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  const batch = db.batch();
  batch.create(userRef, userData);

  if (inviterId) {
    const referralRef = db.collection("referrals").doc(`${inviterId}_${uid}`);
    batch.create(referralRef, {
      inviterId,
      referredUserId: uid,
      channelRewarded: false,
      adsRewarded: false,
      createdAt: FieldValue.serverTimestamp()
    });

    batch.update(db.collection("users").doc(inviterId), {
      referrals: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp()
    });

    notifyNewReferral(inviterId, user.first_name || "New Explorer");
  }

  await batch.commit();

  return res.status(200).json({
    success: true,
    newUser: true,
    user: {
      ...userData,
      vipTier: "Bronze",
      vipMultiplier: 1.0,
      botUsername: CONFIG.BOT_USERNAME,
      isAdmin: uid === String(CONFIG.ADMIN_ID)
    }
  });
}

async function claimStreak(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const userRef = db.collection("users").doc(uid);
  const dToday = today();
  const dYesterday = yesterday();

  let streakReward = 0;
  let newStreak = 1;

  await db.runTransaction(async tx => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error("USER_NOT_FOUND");
    const u = snap.data();

    if (u.lastStreakDate === dToday) {
      throw new Error("STREAK_ALREADY_CLAIMED_TODAY");
    }

    if (u.lastStreakDate === dYesterday) {
      newStreak = ((u.streakDay || 0) % 7) + 1;
    } else {
      newStreak = 1;
    }

    streakReward = CONFIG.DAILY_STREAK_REWARDS[newStreak - 1] || 50;

    tx.update(userRef, {
      balance: FieldValue.increment(streakReward),
      streakDay: newStreak,
      lastStreakDate: dToday,
      updatedAt: FieldValue.serverTimestamp()
    });
  });

  return res.status(200).json({
    success: true,
    streakDay: newStreak,
    reward: streakReward
  });
}

async function verifyMembership(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);

  const results = await Promise.all(
    CONFIG.CHANNELS.map(channel => getChatMember(channel, uid))
  );

  const joined = results.every(memberOK);
  if (!joined) {
    return res.status(200).json({ success: true, joined: false });
  }

  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();
  const u = userDoc.data() || {};

  await userRef.set(
    {
      channelsVerified: true,
      appUnlocked: true,
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  if (u.referredBy) {
    const refDocRef = db.collection("referrals").doc(`${u.referredBy}_${uid}`);
    const refSnap = await refDocRef.get();

    if (refSnap.exists && !refSnap.data().channelRewarded) {
      await db.runTransaction(async tx => {
        tx.update(refDocRef, { channelRewarded: true });
        tx.update(db.collection("users").doc(u.referredBy), {
          balance: FieldValue.increment(CONFIG.REFERRAL_CHANNEL),
          referralPoints: FieldValue.increment(CONFIG.REFERRAL_CHANNEL),
          updatedAt: FieldValue.serverTimestamp()
        });
      });
      notifyReferralBonus(u.referredBy, "Referral joined channels", CONFIG.REFERRAL_CHANNEL);
    }
  }

  return res.status(200).json({ success: true, joined: true });
}

async function claimWelcome(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const address = String(req.body?.address || "").trim();

  if (!ethers.isAddress(address)) throw new Error("INVALID_ADDRESS");
  const normalized = ethers.getAddress(address);

  const userRef = db.collection("users").doc(uid);
  const addressRef = db.collection("welcomeClaims").doc(normalized.toLowerCase());
  const payoutRef = db.collection("payouts").doc();

  await db.runTransaction(async tx => {
    const userSnap = await tx.get(userRef);
    const addressSnap = await tx.get(addressRef);

    if (!userSnap.exists) throw new Error("USER_NOT_FOUND");
    const u = userSnap.data();

    if (!u.channelsVerified) throw new Error("CHANNELS_REQUIRED");
    if (u.welcomeBonusClaimed) throw new Error("WELCOME_ALREADY_CLAIMED");
    if (addressSnap.exists) throw new Error("ADDRESS_ALREADY_USED");

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
    const payment = await sendUSDT(normalized, CONFIG.WELCOME_USDT);

    await payoutRef.update({
      status: "paid",
      txHash: payment.txHash,
      paidAt: FieldValue.serverTimestamp()
    });

    await userRef.update({
      welcomeBonusStatus: "paid",
      updatedAt: FieldValue.serverTimestamp()
    });

    notifyWelcomeBonus(uid, CONFIG.WELCOME_USDT, payment.txHash);
    broadcastPaymentProof({
      type: "welcome",
      userId: uid,
      amountUSDT: CONFIG.WELCOME_USDT,
      txHash: payment.txHash,
      address: normalized
    });

    return res.status(200).json({
      success: true,
      amount: CONFIG.WELCOME_USDT,
      txHash: payment.txHash
    });
  } catch (error) {
    await payoutRef.update({
      status: "failed",
      error: error?.message || String(error),
      updatedAt: FieldValue.serverTimestamp()
    });

    await userRef.update({
      welcomeBonusStatus: "failed",
      updatedAt: FieldValue.serverTimestamp()
    });

    throw error;
  }
}

async function ads(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const provider = String(req.body?.provider || "").toLowerCase();

  if (!["monetag", "adsgram", "hilltop"].includes(provider)) throw new Error("INVALID_PROVIDER");

  const userRef = db.collection("users").doc(uid);
  const d = today();
  let result;
  let shouldRewardInviter = false;
  let inviterId = null;

  const HILLTOP_LIMIT = CONFIG.HILLTOP_LIMIT || 15;
  const monetagLimit = CONFIG.MONETAG_LIMIT || 25;
  const adsgramLimit = CONFIG.ADSGRAM_LIMIT || 25;

  await db.runTransaction(async tx => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error("USER_NOT_FOUND");
    const u = snap.data();

    if (!u.channelsVerified) throw new Error("CHANNELS_REQUIRED");

    let monetagToday = u.adDate === d ? Number(u.monetagToday || 0) : 0;
    let adsgramToday = u.adDate === d ? Number(u.adsgramToday || 0) : 0;
    let hilltopToday = u.adDate === d ? Number(u.hilltopToday || 0) : 0;

    if (provider === "monetag" && monetagToday >= monetagLimit) {
      throw new Error("MONETAG_LIMIT");
    }

    if (provider === "adsgram" && adsgramToday >= adsgramLimit) {
      throw new Error("ADSGRAM_LIMIT");
    }

    if (provider === "hilltop" && hilltopToday >= HILLTOP_LIMIT) {
      throw new Error("HILLTOP_LIMIT");
    }

    if (provider === "monetag") monetagToday++;
    else if (provider === "adsgram") adsgramToday++;
    else if (provider === "hilltop") hilltopToday++;

    const totalAds = Number(u.adsWatched || 0) + 1;
    const vip = getVipTier(u.balance || 0);
    const finalReward = Math.round(CONFIG.AD_REWARD * vip.multiplier);

    tx.update(userRef, {
      balance: FieldValue.increment(finalReward),
      adsWatched: FieldValue.increment(1),
      [`${provider}Ads`]: FieldValue.increment(1),
      monetagToday,
      adsgramToday,
      hilltopToday,
      adDate: d,
      updatedAt: FieldValue.serverTimestamp()
    });

    if (u.referredBy && totalAds >= 2) {
      shouldRewardInviter = true;
      inviterId = u.referredBy;
    }

    result = {
      reward: finalReward,
      monetagToday,
      adsgramToday,
      hilltopToday,
      totalAds
    };
  });

  if (shouldRewardInviter && inviterId) {
    const refDocRef = db.collection("referrals").doc(`${inviterId}_${uid}`);
    const refSnap = await refDocRef.get();

    if (refSnap.exists && !refSnap.data().adsRewarded) {
      await db.runTransaction(async tx => {
        tx.update(refDocRef, { adsRewarded: true });
        tx.update(db.collection("users").doc(inviterId), {
          balance: FieldValue.increment(CONFIG.REFERRAL_ADS),
          referralPoints: FieldValue.increment(CONFIG.REFERRAL_ADS),
          updatedAt: FieldValue.serverTimestamp()
        });
      });
      notifyReferralBonus(inviterId, "Referral watched 2 ads", CONFIG.REFERRAL_ADS);
    }
  }

  return res.status(200).json({ success: true, ...result });
}

async function games(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const action = String(req.body?.action || "").toLowerCase();
  const userRef = db.collection("users").doc(uid);
  const currentRound = getLiveAviatorState(Date.now());

  if (action === "aviator_status") {
    return res.status(200).json({
      success: true,
      ...currentRound
    });
  }

  if (action === "aviator_bet") {
    const bet = Math.floor(Number(req.body?.bet));
    if (!Number.isFinite(bet) || bet <= 0) throw new Error("INVALID_BET");

    const targetRoundIndex = Number(req.body?.roundIndex) || currentRound.roundIndex;
    const betDocRef = db.collection("aviatorBets").doc(`${targetRoundIndex}_${uid}`);

    await db.runTransaction(async tx => {
      const snap = await tx.get(userRef);
      if (!snap.exists) throw new Error("USER_NOT_FOUND");
      const u = snap.data();

      const existingBet = await tx.get(betDocRef);
      if (existingBet.exists) throw new Error("BET_ALREADY_PLACED");

      const balance = Number(u.balance || 0);
      if (balance < bet) throw new Error("INSUFFICIENT_POINTS");

      tx.update(userRef, {
        balance: FieldValue.increment(-bet),
        aviatorGames: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp()
      });

      tx.create(betDocRef, {
        userId: uid,
        roundIndex: targetRoundIndex,
        bet,
        status: "active",
        cashedOut: false,
        createdAt: FieldValue.serverTimestamp()
      });
    });

    return res.status(200).json({
      success: true,
      bet,
      roundIndex: targetRoundIndex
    });
  }

  if (action === "aviator_cashout") {
    const targetRoundIndex = Number(req.body?.roundIndex) || currentRound.roundIndex;
    const claimedMultiplier = Number(req.body?.multiplier) || currentRound.currentMultiplier;
    const betDocRef = db.collection("aviatorBets").doc(`${targetRoundIndex}_${uid}`);

    const actualCrash = calculateRoundCrash(targetRoundIndex);
    let payout = 0;
    let finalMultiplier = 1.00;

    await db.runTransaction(async tx => {
      const betSnap = await tx.get(betDocRef);
      if (!betSnap.exists) throw new Error("NO_ACTIVE_BET");

      const b = betSnap.data();
      if (b.cashedOut || b.status !== "active") {
        throw new Error("ALREADY_CASHED_OUT");
      }

      if (claimedMultiplier > actualCrash) {
        throw new Error("FLEW_AWAY");
      }

      finalMultiplier = Math.min(actualCrash, Math.max(1.00, Number(claimedMultiplier.toFixed(2))));
      payout = Math.floor(b.bet * finalMultiplier);

      tx.update(betDocRef, {
        cashedOut: true,
        cashMultiplier: finalMultiplier,
        payout,
        status: "won",
        updatedAt: FieldValue.serverTimestamp()
      });

      tx.update(userRef, {
        balance: FieldValue.increment(payout),
        aviatorWins: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp()
      });
    });

    return res.status(200).json({
      success: true,
      multiplier: finalMultiplier,
      payout
    });
  }

  throw new Error("UNKNOWN_GAME_ACTION");
}

async function deposit(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const action = String(req.body?.action || "").toLowerCase();

  if (action === "info") {
    return res.status(200).json({
      success: true,
      depositAddress: CONFIG.DEPOSIT_ADDRESS,
      pointsPerUSDT: CONFIG.POINTS_PER_USDT
    });
  }

  if (action === "submit") {
    const txHash = String(req.body?.txHash || "").trim();
    if (!txHash || txHash.length < 10) throw new Error("INVALID_TX_HASH");

    const depositRef = db.collection("deposits").doc(txHash.toLowerCase());

    await db.runTransaction(async tx => {
      const snap = await tx.get(depositRef);
      if (snap.exists) throw new Error("TX_ALREADY_SUBMITTED");

      tx.create(depositRef, {
        userId: uid,
        txHash: txHash.toLowerCase(),
        status: "pending",
        createdAt: FieldValue.serverTimestamp()
      });
    });

    return res.status(200).json({
      success: true,
      message: "Deposit submitted for blockchain verification"
    });
  }

  throw new Error("UNKNOWN_DEPOSIT_ACTION");
}

async function promo(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const code = String(req.body?.code || "").trim().toUpperCase();

  if (!CONFIG.PROMO_CODES.includes(code)) {
    throw new Error("INVALID_CODE");
  }

  const claimRef = db.collection("promoClaims").doc(`${uid}_${code}`);
  const userRef = db.collection("users").doc(uid);

  await db.runTransaction(async tx => {
    const claim = await tx.get(claimRef);
    const u = await tx.get(userRef);

    if (!u.exists) throw new Error("USER_NOT_FOUND");
    if (claim.exists) throw new Error("ALREADY_CLAIMED");

    tx.create(claimRef, {
      userId: uid,
      code,
      reward: CONFIG.PROMO_REWARD,
      createdAt: FieldValue.serverTimestamp()
    });

    tx.update(userRef, {
      balance: FieldValue.increment(CONFIG.PROMO_REWARD),
      updatedAt: FieldValue.serverTimestamp()
    });
  });

  return res.status(200).json({
    success: true,
    reward: CONFIG.PROMO_REWARD
  });
}

async function referral(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const action = String(req.body?.action || "").toLowerCase();

  if (action === "list") {
    const snap = await db.collection("referrals").where("inviterId", "==", uid).get();
    return res.status(200).json({
      success: true,
      referrals: snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    });
  }

  if (action === "leaderboard") {
    const snap = await db.collection("users").orderBy("referrals", "desc").limit(10).get();
    return res.status(200).json({
      success: true,
      leaderboard: snap.docs.map(doc => {
        const d = doc.data();
        return {
          firstName: d.firstName || "User",
          referrals: d.referrals || 0,
          referralPoints: d.referralPoints || 0
        };
      })
    });
  }

  throw new Error("UNKNOWN_ACTION");
}

async function tasks(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const action = String(req.body?.action || "").toLowerCase();

  if (action === "list") {
    const tasksSnap = await db.collection("tasks").where("status", "==", "active").limit(100).get();
    const completedSnap = await db.collection("taskCompletions").where("userId", "==", uid).get();
    const completedTaskIds = new Set(completedSnap.docs.map(doc => doc.data().taskId));

    const availableTasks = tasksSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(task => !completedTaskIds.has(task.id));

    return res.status(200).json({
      success: true,
      tasks: availableTasks
    });
  }

  if (action === "create") {
    const { title, link, chatId, type } = req.body;
    if (!title || !link || !chatId) throw new Error("TASK_DATA_REQUIRED");

    const taskRef = db.collection("tasks").doc();
    const userRef = db.collection("users").doc(uid);

    await db.runTransaction(async tx => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) throw new Error("USER_NOT_FOUND");
      const u = userSnap.data();

      const isAdmin = uid === String(CONFIG.ADMIN_ID);

      if (!isAdmin && Number(u.balance || 0) < CONFIG.TASK_CREATE_COST) {
        throw new Error("INSUFFICIENT_POINTS");
      }

      if (!isAdmin) {
        tx.update(userRef, {
          balance: FieldValue.increment(-CONFIG.TASK_CREATE_COST),
          updatedAt: FieldValue.serverTimestamp()
        });
      }

      tx.create(taskRef, {
        ownerId: uid,
        title: String(title).slice(0, 120),
        link: String(link).slice(0, 500),
        chatId: String(chatId),
        type: String(type || "channel"),
        reward: CONFIG.TASK_REWARD,
        completions: 0,
        maxCompletions: CONFIG.TASK_LIMIT,
        status: "active",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    });

    return res.status(200).json({ success: true, taskId: taskRef.id });
  }

  if (action === "complete") {
    const taskId = String(req.body?.taskId || "");
    if (!taskId) throw new Error("TASK_ID_REQUIRED");

    const taskRef = db.collection("tasks").doc(taskId);
    const completionRef = db.collection("taskCompletions").doc(`${uid}_${taskId}`);
    const userRef = db.collection("users").doc(uid);

    const taskSnap = await taskRef.get();
    if (!taskSnap.exists) throw new Error("TASK_NOT_FOUND");

    const task = taskSnap.data();
    if (task.status !== "active") throw new Error("TASK_CLOSED");

    const member = await getChatMember(task.chatId, uid);
    if (!memberOK(member)) {
      throw new Error("TELEGRAM_MEMBERSHIP_REQUIRED");
    }

    let reward = 0;

    await db.runTransaction(async tx => {
      const freshTask = await tx.get(taskRef);
      const completion = await tx.get(completionRef);
      const userSnap = await tx.get(userRef);

      if (!freshTask.exists || !userSnap.exists) throw new Error("NOT_FOUND");
      if (completion.exists) throw new Error("ALREADY_COMPLETED");

      const t = freshTask.data();
      const count = Number(t.completions || 0);

      if (t.status !== "active" || count >= CONFIG.TASK_LIMIT) {
        throw new Error("TASK_FULL");
      }

      reward = Number(CONFIG.TASK_REWARD);

      tx.create(completionRef, {
        userId: uid,
        taskId,
        reward,
        createdAt: FieldValue.serverTimestamp()
      });

      tx.update(taskRef, {
        completions: count + 1,
        status: count + 1 >= CONFIG.TASK_LIMIT ? "completed" : "active",
        updatedAt: FieldValue.serverTimestamp()
      });

      tx.update(userRef, {
        balance: FieldValue.increment(reward),
        tasksCompleted: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp()
      });
    });

    return res.status(200).json({ success: true, reward });
  }

  throw new Error("UNKNOWN_ACTION");
}

async function withdraw(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const address = String(req.body?.address || "").trim();

  if (!address.startsWith("0x") || address.length !== 42) throw new Error("INVALID_ADDRESS");
  const destination = address.toLowerCase();

  const minPoints = Number(CONFIG.WITHDRAW_MIN_POINTS);
  const pointsPerUSDT = Number(CONFIG.POINTS_PER_USDT);
  const amount = minPoints / pointsPerUSDT;

  const userRef = db.collection("users").doc(uid);
  const withdrawalRef = db.collection("withdrawals").doc();

  await db.runTransaction(async tx => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error("USER_NOT_FOUND");
    const u = snap.data();

    if (!u.channelsVerified) throw new Error("CHANNELS_REQUIRED");
    if (Number(u.balance || 0) < minPoints) throw new Error("MINIMUM_NOT_REACHED");

    tx.update(userRef, {
      balance: FieldValue.increment(-minPoints),
      withdrawals: FieldValue.increment(1),
      lastWithdrawalId: withdrawalRef.id,
      updatedAt: FieldValue.serverTimestamp()
    });

    tx.create(withdrawalRef, {
      userId: uid,
      address: destination,
      points: minPoints,
      amountUSDT: Number(amount.toFixed(8)),
      status: "processing",
      createdAt: FieldValue.serverTimestamp()
    });
  });

  try {
    const payment = await sendUSDT(destination, Number(amount.toFixed(8)));

    await withdrawalRef.update({
      status: "paid",
      txHash: payment.txHash,
      paidAt: FieldValue.serverTimestamp()
    });

    notifyWithdrawalSuccess(uid, amount.toFixed(2), payment.txHash);
    broadcastPaymentProof({
      type: "withdraw",
      userId: uid,
      amountUSDT: Number(amount.toFixed(2)),
      txHash: payment.txHash,
      address: destination
    });

    return res.status(200).json({
      success: true,
      amount: Number(amount.toFixed(8)),
      points: minPoints,
      txHash: payment.txHash
    });
  } catch (error) {
    await db.runTransaction(async tx => {
      tx.update(userRef, {
        balance: FieldValue.increment(minPoints),
        updatedAt: FieldValue.serverTimestamp()
      });

      tx.update(withdrawalRef, {
        status: "failed",
        error: error?.message || String(error),
        updatedAt: FieldValue.serverTimestamp()
      });
    });

    throw error;
  }
}

async function telegram(req, res) {
  const update = req.body || {};

  if (update?.message?.text?.startsWith("/start")) {
    const chatId = update.message.chat.id;
    const firstName = update.message.from?.first_name || "Trader";
    const text = update.message.text.trim();
    const parts = text.split(" ");
    const startParam = parts.length > 1 ? parts[1] : "";

    const baseUrl = "https://usdt-hub-1.vercel.app";
    const launchUrl = startParam ? `${baseUrl}?startapp=${startParam}` : baseUrl;

    const welcomeMessage = [
      `💎 <b>WELCOME TO USDT HUB, ${firstName.toUpperCase()}!</b> 💎`,
      `<i>The #1 Automated Micro-Earning & Live Gaming Hub on Telegram.</i>`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━`,
      `🎁 <b>0.01 USDT Welcome Gift:</b> Instant BEP20 blockchain payout`,
      `📺 <b>Daily Ad Mining:</b> Earn up to 3,000+ PTS daily with Monetag & HilltopAds`,
      `✈️ <b>Live Aviator Arena:</b> Provably fair multiplayer flight multiplier`,
      `👥 <b>500 PTS / Referral:</b> 300 PTS on join + 200 PTS on 2 ads`,
      `💸 <b>Direct BEP20 Payouts:</b> 10,000 PTS = 0.10 USDT (Auto-sent to wallet)`,
      `━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `⚡ <b>Quick Exchange Rate:</b>`,
      `<code>10,000 PTS  =  0.10 USDT</code>`,
      `<code>100,000 PTS =  1.00 USDT</code>`,
      ``,
      `👇 <b>Tap below to launch the Mini App and claim your bonus!</b>`
    ].join("\n");

    await sendMessage(
      chatId,
      welcomeMessage,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🚀 OPEN USDT HUB APP",
                web_app: { url: launchUrl }
              }
            ],
            [
              {
                text: "📢 Payment Proofs",
                url: "https://t.me/birr_gram"
              },
              {
                text: "💎 Official News",
                url: "https://t.me/usdt_g_ram"
              }
            ],
            [
              {
                text: "💬 Community & Support",
                url: `https://t.me/${CONFIG.SUPPORT_USERNAME || "birr_gram"}`
              }
            ]
          ]
        }
      }
    );
  }

  return res.status(200).json({ success: true });
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  try {
    const path = getPath(req);
    const endpoint = req.query?.endpoint || req.body?.endpoint || "";

    if (path === "/api/index" || path === "/api" || path === "/") {
      if (!endpoint && req.method === "GET") {
        return res.status(200).json({ success: true, message: "USDT Hub API Online" });
      }
    }

    if (path === "/api/payout-info" || endpoint === "payout-info") {
      const info = await getPayoutWalletInfo();
      return res.status(200).json({ success: true, ...info });
    }

    if (path === "/api/telegram" || endpoint === "telegram") {
      return telegram(req, res);
    }

    if (path === "/api/user" || endpoint === "user") return userHandler(req, res);
    if (path === "/api/claim-streak" || endpoint === "claim-streak") return claimStreak(req, res);
    if (path === "/api/verify-membership" || endpoint === "verify-membership") return verifyMembership(req, res);
    if (path === "/api/claim-welcome" || endpoint === "claim-welcome") return claimWelcome(req, res);
    if (path === "/api/ads" || endpoint === "ads") return ads(req, res);
    if (path === "/api/games" || endpoint === "games") return games(req, res);
    if (path === "/api/deposit" || endpoint === "deposit") return deposit(req, res);
    if (path === "/api/promo" || endpoint === "promo") return promo(req, res);
    if (path === "/api/referral" || endpoint === "referral") return referral(req, res);
    if (path === "/api/tasks" || endpoint === "tasks") return tasks(req, res);
    if (path === "/api/withdraw" || endpoint === "withdraw") return withdraw(req, res);

    return res.status(404).json({
      success: false,
      error: `API route not found: ${path}`
    });
  } catch (error) {
    console.error("USDT HUB API ERROR:", error);
    return res.status(200).json({
      success: false,
      error: error?.message || String(error)
    });
  }
}
