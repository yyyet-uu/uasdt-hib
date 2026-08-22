import { db, FieldValue } from "../lib/firebase.js";
import {
  validateInitData,
  getInitData
} from "../lib/auth.js";

import {
  getChatMember,
  sendMessage
} from "../lib/telegram.js";

import {
  sendUSDT,
  getPayoutWalletInfo
} from "../lib/payout.js";

import { CONFIG } from "../lib/config.js";
import { ethers } from "ethers";

// =====================================================
// HELPERS
// =====================================================

function getPath(req) {
  return String(req.url || "")
    .split("?")[0]
    .replace(/\/+$/, "") || "/";
}

function today() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

function memberOK(member) {
  return [
    "member",
    "administrator",
    "creator"
  ].includes(member?.status);
}

function getUser(req) {
  const initData = getInitData(req);

  if (!initData) {
    throw new Error("TELEGRAM_INIT_DATA_MISSING");
  }

  const result = validateInitData(initData);

  if (!result?.user) {
    throw new Error("INVALID_TELEGRAM_USER");
  }

  return result;
}

// Synchronized Aviator round calculation
function getLiveAviatorRound(timestamp = Date.now()) {
  const epochSeconds = Math.floor(timestamp / 1000);
  const roundIndex = Math.floor(epochSeconds / 15);
  const msInRound = timestamp % 15000;

  const seed = (roundIndex * 9301 + 49297) % 233280;
  const rand = seed / 233280;
  let crashMultiplier;

  if (rand < 0.40) crashMultiplier = 1.00 + rand * 0.5;
  else if (rand < 0.70) crashMultiplier = 1.20 + (rand - 0.40) * 2.0;
  else if (rand < 0.88) crashMultiplier = 1.80 + (rand - 0.70) * 7.0;
  else if (rand < 0.96) crashMultiplier = 3.00 + (rand - 0.88) * 25.0;
  else crashMultiplier = 5.00 + (rand - 0.96) * 150.0;

  crashMultiplier = Math.round(crashMultiplier * 100) / 100;
  const flyTimeMs = Math.min(7000, Math.max(1500, Math.log(crashMultiplier + 1) * 3500));
  const bettingDuration = 5000;

  let phase;
  let currentMultiplier = 1.00;

  if (msInRound < bettingDuration) {
    phase = "BETTING";
  } else if (msInRound < bettingDuration + flyTimeMs) {
    phase = "FLYING";
    const progress = (msInRound - bettingDuration) / flyTimeMs;
    currentMultiplier = Math.min(crashMultiplier, Math.max(1.00, 1.00 + (crashMultiplier - 1.00) * Math.pow(progress, 1.8)));
  } else {
    phase = "CRASHED";
    currentMultiplier = crashMultiplier;
  }

  return {
    roundIndex,
    phase,
    crashMultiplier,
    currentMultiplier: Number(currentMultiplier.toFixed(2)),
    msInRound
  };
}

// =====================================================
// HEALTH & PAYOUT INFO
// =====================================================

async function health(req, res) {
  return res.status(200).json({
    success: true,
    message: "USDT Hub API is working",
    method: req.method,
    path: getPath(req)
  });
}

async function payoutInfo(req, res) {
  try {
    const info = await getPayoutWalletInfo();
    return res.status(200).json({
      success: true,
      ...info
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || String(error)
    });
  }
}

// =====================================================
// USER
// =====================================================

async function userHandler(req, res) {
  const { user, startParam } = getUser(req);
  const uid = String(user.id);
  const userRef = db.collection("users").doc(uid);
  const existing = await userRef.get();

  if (existing.exists) {
    const userData = existing.data();
    return res.json({
      success: true,
      newUser: false,
      user: {
        ...userData,
        botUsername: CONFIG.BOT_USERNAME
      }
    });
  }

  let inviterId = null;
  if (startParam && String(startParam).startsWith("ref_")) {
    const possible = String(startParam).slice(4);
    if (possible && possible !== uid) {
      const inviter = await db.collection("users").doc(possible).get();
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
      channelReward: CONFIG.REFERRAL_CHANNEL,
      adsReward: CONFIG.REFERRAL_ADS,
      channelRewarded: false,
      adsRewarded: false,
      createdAt: FieldValue.serverTimestamp()
    });

    batch.update(db.collection("users").doc(inviterId), {
      referrals: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp()
    });
  }

  await batch.commit();

  return res.status(201).json({
    success: true,
    newUser: true,
    user: {
      ...userData,
      botUsername: CONFIG.BOT_USERNAME
    }
  });
}

// =====================================================
// CHANNEL MEMBERSHIP
// =====================================================

async function verifyMembership(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);

  if (!Array.isArray(CONFIG.CHANNELS) || CONFIG.CHANNELS.length === 0) {
    throw new Error("CHANNELS_NOT_CONFIGURED");
  }

  const results = await Promise.all(
    CONFIG.CHANNELS.map(channel => getChatMember(channel, uid))
  );

  const joined = results.every(memberOK);

  if (!joined) {
    return res.json({
      success: true,
      joined: false
    });
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

  // If referred, credit inviter for channel join
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
    }
  }

  return res.json({
    success: true,
    joined: true
  });
}

// =====================================================
// WELCOME BONUS
// =====================================================

async function claimWelcome(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const address = String(req.body?.address || "").trim();

  if (!ethers.isAddress(address)) {
    throw new Error("INVALID_ADDRESS");
  }

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

    try {
      await sendMessage(
        uid,
        `🎁 <b>Welcome bonus sent!</b>\n\n💰 ${CONFIG.WELCOME_USDT} USDT\n\n🔗 ${payment.txHash}`
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

// =====================================================
// ADS
// =====================================================

async function ads(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const provider = String(req.body?.provider || "").toLowerCase();

  if (!["monetag", "adsgram"].includes(provider)) {
    throw new Error("INVALID_PROVIDER");
  }

  const userRef = db.collection("users").doc(uid);
  const d = today();
  let result;

  await db.runTransaction(async tx => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error("USER_NOT_FOUND");
    const u = snap.data();

    if (!u.channelsVerified) throw new Error("CHANNELS_REQUIRED");

    let monetagToday = u.adDate === d ? Number(u.monetagToday || 0) : 0;
    let adsgramToday = u.adDate === d ? Number(u.adsgramToday || 0) : 0;

    if (provider === "monetag" && monetagToday >= CONFIG.MONETAG_LIMIT) {
      throw new Error("MONETAG_LIMIT");
    }

    if (provider === "adsgram" && adsgramToday >= CONFIG.ADSGRAM_LIMIT) {
      throw new Error("ADSGRAM_LIMIT");
    }

    if (provider === "monetag") monetagToday++;
    else adsgramToday++;

    tx.update(userRef, {
      balance: FieldValue.increment(CONFIG.AD_REWARD),
      adsWatched: FieldValue.increment(1),
      [`${provider}Ads`]: FieldValue.increment(1),
      monetagToday,
      adsgramToday,
      adDate: d,
      updatedAt: FieldValue.serverTimestamp()
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

// =====================================================
// LIVE SYNCHRONIZED AVIATOR
// =====================================================

async function games(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const action = String(req.body?.action || "").toLowerCase();
  const userRef = db.collection("users").doc(uid);
  const currentRound = getLiveAviatorRound(Date.now());

  if (action === "aviator_status") {
    return res.json({
      success: true,
      ...currentRound
    });
  }

  // User places bet for the current synchronized round
  if (action === "aviator_bet") {
    const bet = Number(req.body?.bet);
    if (!Number.isFinite(bet) || bet <= 0) throw new Error("INVALID_BET");

    if (currentRound.phase !== "BETTING") {
      throw new Error("ROUND_ALREADY_STARTED");
    }

    const betDocRef = db.collection("aviatorBets").doc(`${currentRound.roundIndex}_${uid}`);

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
        roundIndex: currentRound.roundIndex,
        bet,
        status: "active",
        cashedOut: false,
        createdAt: FieldValue.serverTimestamp()
      });
    });

    return res.json({
      success: true,
      bet,
      roundIndex: currentRound.roundIndex
    });
  }

  // User cashes out during live flight
  if (action === "aviator_cashout") {
    if (currentRound.phase !== "FLYING") {
      throw new Error("CANNOT_CASHOUT_NOW");
    }

    const betDocRef = db.collection("aviatorBets").doc(`${currentRound.roundIndex}_${uid}`);
    let payout = 0;

    await db.runTransaction(async tx => {
      const betSnap = await tx.get(betDocRef);
      if (!betSnap.exists) throw new Error("NO_ACTIVE_BET");

      const b = betSnap.data();
      if (b.cashedOut || b.status !== "active") {
        throw new Error("ALREADY_CASHED_OUT");
      }

      const multiplier = currentRound.currentMultiplier;
      payout = Number((b.bet * multiplier).toFixed(2));

      tx.update(betDocRef, {
        cashedOut: true,
        cashMultiplier: multiplier,
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

    return res.json({
      success: true,
      multiplier: currentRound.currentMultiplier,
      payout
    });
  }

  throw new Error("UNKNOWN_GAME_ACTION");
}

// =====================================================
// DEPOSIT
// =====================================================

async function deposit(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const action = String(req.body?.action || "").toLowerCase();

  if (action === "info") {
    return res.json({
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

    return res.json({
      success: true,
      message: "Deposit submitted for verification"
    });
  }

  throw new Error("UNKNOWN_DEPOSIT_ACTION");
}

// =====================================================
// PROMO
// =====================================================

const PROMO_CODES = [
  "USDTHUB", "MONDAYUSDT", "TUESDAYUSDT", "MONEYTIME",
  "CRYPTOBONUS", "BIRRGRAM2026", "FASTUSDT", "DAILYCLAIM",
  "LUCKYWIN", "REWARD777", "TELEGRAMVIP", "EARNMORE",
  "BINANCEHUB", "FREEUSDT200", "CLAIMNOW", "MEGAREWARD",
  "SUPERPAY", "BOOSTPOINTS", "STARTHUB", "GOLDENUSDT"
];

async function promo(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const code = String(req.body?.code || "").trim().toUpperCase();

  if (!PROMO_CODES.includes(code)) {
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

  return res.json({
    success: true,
    reward: CONFIG.PROMO_REWARD
  });
}

// =====================================================
// REFERRALS
// =====================================================

async function referral(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const action = String(req.body?.action || "").toLowerCase();

  if (action === "list") {
    const snap = await db.collection("referrals").where("inviterId", "==", uid).get();
    return res.json({
      success: true,
      referrals: snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    });
  }

  throw new Error("UNKNOWN_ACTION");
}

// =====================================================
// TASKS
// =====================================================

async function tasks(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const action = String(req.body?.action || "").toLowerCase();

  if (action === "list") {
    const snap = await db.collection("tasks").where("status", "==", "active").limit(100).get();
    return res.json({
      success: true,
      tasks: snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
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

      const isAdmin = uid === String(CONFIG.ADMIN_ID || "");

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

    return res.json({
      success: true,
      taskId: taskRef.id
    });
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

    return res.json({
      success: true,
      reward
    });
  }

  throw new Error("UNKNOWN_ACTION");
}

// =====================================================
// WITHDRAW
// =====================================================

async function withdraw(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const address = String(req.body?.address || "").trim();

  if (!ethers.isAddress(address)) throw new Error("INVALID_ADDRESS");

  const destination = ethers.getAddress(address);
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

    return res.json({
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

// =====================================================
// TELEGRAM WEBHOOK
// =====================================================

async function telegram(req, res) {
  const update = req.body || {};

  if (update?.message?.text?.startsWith("/start")) {
    const chatId = update.message.chat.id;
    const webAppUrl = CONFIG.WEBAPP_URL;

    if (webAppUrl) {
      await sendMessage(
        chatId,
        "🔥 <b>Welcome to USDT Hub!</b>\n\nEarn rewards from ads, tasks, referrals, and play live Aviator.",
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🚀 OPEN USDT HUB",
                  web_app: { url: webAppUrl }
                }
              ]
            ]
          }
        }
      );
    }
  }

  return res.json({ success: true });
}

// =====================================================
// MAIN ROUTER
// =====================================================

export default async function handler(req, res) {
  try {
    const path = getPath(req);

    if (path === "/api/index" || path === "/api") return health(req, res);
    if (path === "/api/payout-info") {
      if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });
      return payoutInfo(req, res);
    }
    if (path === "/api/telegram") {
      if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });
      return telegram(req, res);
    }

    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    if (path === "/api/user") return userHandler(req, res);
    if (path === "/api/verify-membership") return verifyMembership(req, res);
    if (path === "/api/claim-welcome") return claimWelcome(req, res);
    if (path === "/api/ads") return ads(req, res);
    if (path === "/api/games") return games(req, res);
    if (path === "/api/deposit") return deposit(req, res);
    if (path === "/api/promo") return promo(req, res);
    if (path === "/api/referral") return referral(req, res);
    if (path === "/api/tasks") return tasks(req, res);
    if (path === "/api/withdraw") return withdraw(req, res);

    return res.status(404).json({ success: false, error: "API route not found", path });
  } catch (error) {
    console.error("USDT HUB API ERROR:", error);
    return res.status(500).json({ success: false, error: error?.message || String(error) });
  }
}
