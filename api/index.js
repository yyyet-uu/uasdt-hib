import { db, FieldValue } from "../lib/firebase.js";
import { validateInitData, getInitData } from "../lib/auth.js";
import { getChatMember, sendMessage } from "../lib/telegram.js";
import { sendUSDT } from "../lib/payout.js";
import { CONFIG } from "../lib/config.js";
import { ethers } from "ethers";


// =====================================================
// HELPERS
// =====================================================

function today() {
  return new Date().toISOString().slice(0, 10);
}

function memberOK(member) {
  return ["member", "administrator", "creator"].includes(
    member?.status
  );
}

function getAction(req) {
  return String(
    req.query?.action ||
    req.body?.action ||
    ""
  ).toLowerCase();
}

function getPath(req) {
  return String(req.url || "")
    .split("?")[0]
    .replace(/\/+$/, "") || "/";
}

function jsonError(res, status, error) {
  return res.status(status).json({
    success: false,
    error
  });
}


// =====================================================
// USER
// =====================================================

async function register(req, res) {
  const { user, startParam } =
    validateInitData(getInitData(req));

  const uid = String(user.id);
  const userRef = db.collection("users").doc(uid);

  const existing = await userRef.get();

  if (existing.exists) {
    return res.json({
      success: true,
      newUser: false,
      user: existing.data()
    });
  }

  let inviterId = null;

  if (
    startParam &&
    startParam.startsWith("ref_")
  ) {
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


// =====================================================
// CHANNEL VERIFICATION
// =====================================================

async function verifyMembership(req, res) {
  const { user } =
    validateInitData(getInitData(req));

  const uid = String(user.id);

  const channels = Array.isArray(CONFIG.CHANNELS)
    ? CONFIG.CHANNELS
    : [];

  if (!channels.length) {
    return jsonError(
      res,
      500,
      "CHANNELS_NOT_CONFIGURED"
    );
  }

  const results = await Promise.all(
    channels.map(channel =>
      getChatMember(channel, uid)
    )
  );

  const joined = results.every(memberOK);

  if (!joined) {
    return res.json({
      success: true,
      joined: false
    });
  }

  await db
    .collection("users")
    .doc(uid)
    .update({
      channelsVerified: true,
      updatedAt: FieldValue.serverTimestamp()
    });

  return res.json({
    success: true,
    joined: true
  });
}


// =====================================================
// WELCOME BONUS
// =====================================================

async function claimWelcome(req, res) {
  const { user } =
    validateInitData(getInitData(req));

  const uid = String(user.id);

  const address = String(
    req.body?.address || ""
  ).trim();

  if (!ethers.isAddress(address)) {
    return jsonError(
      res,
      400,
      "INVALID_ADDRESS"
    );
  }

  const normalized = ethers.getAddress(address);

  const userRef = db
    .collection("users")
    .doc(uid);

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


// =====================================================
// ADS
// =====================================================

function isMonetagPostback(req) {
  return Boolean(
    req.query?.telegram_id &&
    req.query?.ymid
  );
}

async function monetagPostback(req, res) {
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

  const eventRef = db
    .collection("monetagEvents")
    .doc(eventId);

  const userRef = db
    .collection("users")
    .doc(String(telegram_id));

  await db.runTransaction(async tx => {
    const oldEvent = await tx.get(eventRef);

    if (oldEvent.exists) {
      return;
    }

    const user = await tx.get(userRef);

    if (!user.exists) {
      throw new Error("USER_NOT_FOUND");
    }

    tx.create(eventRef, {
      userId: String(telegram_id),
      ymid,
      zoneId: zone_id || null,
      reward: CONFIG.AD_REWARD,
      createdAt: FieldValue.serverTimestamp()
    });

    tx.update(userRef, {
      balance: FieldValue.increment(
        CONFIG.AD_REWARD
      ),

      adsWatched: FieldValue.increment(1),
      monetagAds: FieldValue.increment(1),

      updatedAt: FieldValue.serverTimestamp()
    });
  });

  return res.status(200).send("ok");
}

async function rewardAd(req, res) {
  const { user } =
    validateInitData(getInitData(req));

  const uid = String(user.id);

  const provider = String(
    req.body?.provider || ""
  );

  if (!["monetag", "adsgram"].includes(provider)) {
    throw new Error("INVALID_PROVIDER");
  }

  const userRef = db
    .collection("users")
    .doc(uid);

  const rewardRef = db
    .collection("adRewards")
    .doc();

  let result;

  await db.runTransaction(async tx => {
    const snap = await tx.get(userRef);

    if (!snap.exists) {
      throw new Error("USER_NOT_FOUND");
    }

    const u = snap.data();

    if (!u.channelsVerified) {
      throw new Error("CHANNELS_REQUIRED");
    }

    const d = today();

    let monetagToday =
      Number(u.monetagToday || 0);

    let adsgramToday =
      Number(u.adsgramToday || 0);

    if (u.adDate !== d) {
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

    tx.update(userRef, {
      balance: FieldValue.increment(
        CONFIG.AD_REWARD
      ),

      adsWatched: FieldValue.increment(1),

      [`${provider}Ads`]:
        FieldValue.increment(1),

      monetagToday,
      adsgramToday,
      adDate: d,

      updatedAt: FieldValue.serverTimestamp()
    });

    tx.create(rewardRef, {
      userId: uid,
      provider,
      reward: CONFIG.AD_REWARD,
      date: d,
      createdAt: FieldValue.serverTimestamp()
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
// GAMES
// =====================================================

async function games(req, res) {
  const { user } =
    validateInitData(getInitData(req));

  const uid = String(user.id);
  const action = String(
    req.body?.action || ""
  );

  const userRef = db
    .collection("users")
    .doc(uid);

  // -----------------------------
  // XO
  // -----------------------------

  if (action === "xo") {
    const choice = String(
      req.body?.choice || ""
    ).toLowerCase();

    if (!["x", "o"].includes(choice)) {
      throw new Error("INVALID_CHOICE");
    }

    let result;

    await db.runTransaction(async tx => {
      const snap = await tx.get(userRef);

      if (!snap.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      const u = snap.data();
      const d = today();

      let plays =
        u.xoPlayDate === d
          ? Number(u.xoDailyPlays || 0)
          : 0;

      if (plays >= CONFIG.XO_LIMIT) {
        throw new Error("XO_LIMIT");
      }

      if (
        Number(u.balance || 0) <
        Number(CONFIG.XO_ENTRY)
      ) {
        throw new Error("INSUFFICIENT_POINTS");
      }

      plays++;

      const win = Math.random() < 0.42;

      const payout = win
        ? Number(CONFIG.XO_WIN)
        : 0;

      const newBalance =
        Number(u.balance || 0) -
        Number(CONFIG.XO_ENTRY) +
        payout;

      tx.update(userRef, {
        balance: newBalance,

        xoDailyPlays: plays,
        xoPlayDate: d,

        xoPlays:
          FieldValue.increment(1),

        xoWins:
          win
            ? FieldValue.increment(1)
            : FieldValue.increment(0),

        updatedAt:
          FieldValue.serverTimestamp()
      });

      result = {
        win,
        payout,
        plays,
        remaining:
          Number(CONFIG.XO_LIMIT) - plays,
        balance: newBalance
      };
    });

    return res.json({
      success: true,
      ...result
    });
  }

  // -----------------------------
  // AVIATOR
  // -----------------------------

  if (action === "aviator") {
    const bet = Number(req.body?.bet);

    if (
      !Number.isInteger(bet) ||
      bet <= 0
    ) {
      throw new Error("INVALID_BET");
    }

    if (bet > 100000) {
      throw new Error("BET_TOO_HIGH");
    }

    let result;

    await db.runTransaction(async tx => {
      const snap = await tx.get(userRef);

      if (!snap.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      const u = snap.data();

      const balance =
        Number(u.balance || 0);

      if (balance < bet) {
        throw new Error("INSUFFICIENT_POINTS");
      }

      /*
       * IMPORTANT:
       * The frontend can animate the multiplier live,
       * but the final result is generated here on the
       * server so the client cannot control the payout.
       */

      const r = Math.random();

      let multiplier;

      if (r < 0.55) multiplier = 1;
      else if (r < 0.75) multiplier = 1.2;
      else if (r < 0.88) multiplier = 1.5;
      else if (r < 0.96) multiplier = 2;
      else if (r < 0.985) multiplier = 3;
      else if (r < 0.995) multiplier = 5;
      else multiplier = 10;

      const payout =
        multiplier > 1
          ? Math.floor(bet * multiplier)
          : 0;

      const newBalance =
        balance - bet + payout;

      tx.update(userRef, {
        balance: newBalance,

        aviatorGames:
          FieldValue.increment(1),

        aviatorWins:
          multiplier > 1
            ? FieldValue.increment(1)
            : FieldValue.increment(0),

        updatedAt:
          FieldValue.serverTimestamp()
      });

      result = {
        bet,
        multiplier,
        payout,
        balance: newBalance
      };
    });

    return res.json({
      success: true,
      ...result
    });
  }

  throw new Error("UNKNOWN_GAME");
}


// =====================================================
// PROMO
// =====================================================

const CODES = [
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

async function promo(req, res) {
  const { user } =
    validateInitData(getInitData(req));

  const uid = String(user.id);

  const code = String(
    req.body?.code || ""
  )
    .trim()
    .toUpperCase();

  if (!CODES.includes(code)) {
    throw new Error("INVALID_CODE");
  }

  const claimRef = db
    .collection("promoClaims")
    .doc(`${uid}_${code}`);

  const userRef = db
    .collection("users")
    .doc(uid);

  await db.runTransaction(async tx => {
    const claim = await tx.get(claimRef);
    const u = await tx.get(userRef);

    if (!u.exists) {
      throw new Error("USER_NOT_FOUND");
    }

    if (claim.exists) {
      throw new Error("ALREADY_CLAIMED");
    }

    tx.create(claimRef, {
      userId: uid,
      code,
      reward: CONFIG.PROMO_REWARD,
      createdAt: FieldValue.serverTimestamp()
    });

    tx.update(userRef, {
      balance:
        FieldValue.increment(
          CONFIG.PROMO_REWARD
        ),

      updatedAt:
        FieldValue.serverTimestamp()
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
  const { user } =
    validateInitData(getInitData(req));

  const uid = String(user.id);

  const action = String(
    req.body?.action || ""
  );

  if (action === "list") {
    const snap = await db
      .collection("referrals")
      .where("inviterId", "==", uid)
      .get();

    return res.json({
      success: true,

      referrals: snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
    });
  }

  if (action === "check") {
    const snap = await db
      .collection("referrals")
      .where(
        "referredUserId",
        "==",
        uid
      )
      .limit(1)
      .get();

    if (snap.empty) {
      return res.json({
        success: true
      });
    }

    const refDoc = snap.docs[0];

    await db.runTransaction(async tx => {
      const refRef = db
        .collection("referrals")
        .doc(refDoc.id);

      const refSnap = await tx.get(refRef);

      if (!refSnap.exists) {
        throw new Error("REFERRAL_NOT_FOUND");
      }

      const ref = refSnap.data();

      const referredRef = db
        .collection("users")
        .doc(uid);

      const inviterRef = db
        .collection("users")
        .doc(String(ref.inviterId));

      const referredSnap =
        await tx.get(referredRef);

      const inviterSnap =
        await tx.get(inviterRef);

      if (!referredSnap.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      if (!inviterSnap.exists) {
        throw new Error("INVITER_NOT_FOUND");
      }

      const u = referredSnap.data();

      const updates = {};

      let balanceReward = 0;
      let referralPoints = 0;

      if (
        u.channelsVerified &&
        !ref.channelRewarded
      ) {
        updates.channelRewarded = true;

        balanceReward +=
          Number(CONFIG.REFERRAL_CHANNEL);

        referralPoints +=
          Number(CONFIG.REFERRAL_CHANNEL);
      }

      if (
        Number(u.adsWatched || 0) >= 2 &&
        !ref.adsRewarded
      ) {
        updates.adsRewarded = true;

        balanceReward +=
          Number(CONFIG.REFERRAL_ADS);

        referralPoints +=
          Number(CONFIG.REFERRAL_ADS);
      }

      if (balanceReward > 0) {
        tx.update(inviterRef, {
          balance:
            FieldValue.increment(
              balanceReward
            ),

          referralPoints:
            FieldValue.increment(
              referralPoints
            ),

          updatedAt:
            FieldValue.serverTimestamp()
        });
      }

      if (Object.keys(updates).length) {
        tx.update(refRef, updates);
      }
    });

    return res.json({
      success: true
    });
  }

  throw new Error("UNKNOWN_ACTION");
}


// =====================================================
// TASKS
// =====================================================

async function tasks(req, res) {
  const { user } =
    validateInitData(getInitData(req));

  const uid = String(user.id);

  const action = String(
    req.body?.action || ""
  );

  if (action === "list") {
    const snap = await db
      .collection("tasks")
      .where("status", "==", "active")
      .limit(100)
      .get();

    return res.json({
      success: true,

      tasks: snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
    });
  }

  if (action === "create") {
    const {
      title,
      link,
      chatId,
      type
    } = req.body;

    if (!title || !link || !chatId) {
      throw new Error("TASK_DATA_REQUIRED");
    }

    if (!["channel", "bot"].includes(type)) {
      throw new Error("INVALID_TASK_TYPE");
    }

    const userRef = db
      .collection("users")
      .doc(uid);

    const taskRef = db
      .collection("tasks")
      .doc();

    await db.runTransaction(async tx => {
      const userSnap =
        await tx.get(userRef);

      if (!userSnap.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      const u = userSnap.data();

      const isAdmin =
        uid === String(
          process.env.TELEGRAM_ADMIN_ID || ""
        );

      const balance =
        Number(u.balance || 0);

      if (
        !isAdmin &&
        balance < CONFIG.TASK_CREATE_COST
      ) {
        throw new Error(
          "INSUFFICIENT_POINTS"
        );
      }

      if (!isAdmin) {
        tx.update(userRef, {
          balance:
            FieldValue.increment(
              -CONFIG.TASK_CREATE_COST
            ),

          updatedAt:
            FieldValue.serverTimestamp()
        });
      }

      tx.create(taskRef, {
        ownerId: uid,

        title: String(title).slice(0, 120),
        link: String(link).slice(0, 500),
        chatId: String(chatId),

        type,

        reward: CONFIG.TASK_REWARD,

        completions: 0,
        maxCompletions: CONFIG.TASK_LIMIT,

        status: "active",

        createdAt:
          FieldValue.serverTimestamp(),

        updatedAt:
          FieldValue.serverTimestamp()
      });
    });

    return res.json({
      success: true,
      taskId: taskRef.id
    });
  }

  if (action === "complete") {
    const taskId = String(
      req.body?.taskId || ""
    );

    if (!taskId) {
      throw new Error("TASK_ID_REQUIRED");
    }

    const taskRef = db
      .collection("tasks")
      .doc(taskId);

    const completionRef = db
      .collection("taskCompletions")
      .doc(`${uid}_${taskId}`);

    const userRef = db
      .collection("users")
      .doc(uid);

    const taskSnap = await taskRef.get();

    if (!taskSnap.exists) {
      throw new Error("TASK_NOT_FOUND");
    }

    const task = taskSnap.data();

    if (task.status !== "active") {
      throw new Error("TASK_CLOSED");
    }

    const member = await getChatMember(
      task.chatId,
      uid
    );

    if (!memberOK(member)) {
      throw new Error(
        "TELEGRAM_MEMBERSHIP_REQUIRED"
      );
    }

    let reward = 0;

    await db.runTransaction(async tx => {
      const freshTask =
        await tx.get(taskRef);

      const completion =
        await tx.get(completionRef);

      const user =
        await tx.get(userRef);

      if (!freshTask.exists) {
        throw new Error("TASK_NOT_FOUND");
      }

      if (!user.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      if (completion.exists) {
        throw new Error("ALREADY_COMPLETED");
      }

      const t = freshTask.data();

      if (t.status !== "active") {
        throw new Error("TASK_CLOSED");
      }

      const current =
        Number(t.completions || 0);

      if (current >= CONFIG.TASK_LIMIT) {
        throw new Error("TASK_FULL");
      }

      reward =
        Number(CONFIG.TASK_REWARD);

      const newCount = current + 1;

      tx.create(completionRef, {
        userId: uid,
        taskId,
        reward,
        createdAt:
          FieldValue.serverTimestamp()
      });

      tx.update(taskRef, {
        completions: newCount,

        status:
          newCount >= CONFIG.TASK_LIMIT
            ? "completed"
            : "active",

        updatedAt:
          FieldValue.serverTimestamp()
      });

      tx.update(userRef, {
        balance:
          FieldValue.increment(reward),

        tasksCompleted:
          FieldValue.increment(1),

        updatedAt:
          FieldValue.serverTimestamp()
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
  const { user } =
    validateInitData(getInitData(req));

  const uid = String(user.id);

  const address = String(
    req.body?.address || ""
  ).trim();

  if (!ethers.isAddress(address)) {
    throw new Error("INVALID_ADDRESS");
  }

  const destination =
    ethers.getAddress(address);

  const userRef = db
    .collection("users")
    .doc(uid);

  const withdrawalRef = db
    .collection("withdrawals")
    .doc();

  const withdrawalPoints =
    Number(CONFIG.WITHDRAW_MIN_POINTS);

  const withdrawalAmount =
    withdrawalPoints /
    Number(CONFIG.POINTS_PER_USDT);

  let withdrawalId = null;

  try {
    await db.runTransaction(async tx => {
      const userSnap =
        await tx.get(userRef);

      if (!userSnap.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      const u = userSnap.data();

      if (!u.channelsVerified) {
        throw new Error("CHANNELS_REQUIRED");
      }

      const balance =
        Number(u.balance || 0);

      if (balance < withdrawalPoints) {
        throw new Error(
          "MINIMUM_NOT_REACHED"
        );
      }

      withdrawalId =
        withdrawalRef.id;

      tx.update(userRef, {
        balance:
          FieldValue.increment(
            -withdrawalPoints
          ),

        withdrawals:
          FieldValue.increment(1),

        lastWithdrawalId:
          withdrawalId,

        updatedAt:
          FieldValue.serverTimestamp()
      });

      tx.create(withdrawalRef, {
        userId: uid,

        address: destination,

        points: withdrawalPoints,

        amountUSDT:
          Number(
            withdrawalAmount.toFixed(8)
          ),

        status: "processing",

        createdAt:
          FieldValue.serverTimestamp()
      });
    });

    const payment = await sendUSDT(
      destination,
      Number(
        withdrawalAmount.toFixed(8)
      )
    );

    await withdrawalRef.update({
      status: "paid",
      txHash: payment.txHash,
      paidAt: FieldValue.serverTimestamp()
    });

    try {
      await sendMessage(
        uid,
        `✅ <b>Withdrawal successful!</b>\n\n💰 ${withdrawalAmount.toFixed(8)} USDT\n📍 ${destination}\n🔗 ${payment.txHash}`
      );
    } catch {}

    return res.json({
      success: true,

      amount:
        Number(
          withdrawalAmount.toFixed(8)
        ),

      points:
        withdrawalPoints,

      txHash:
        payment.txHash
    });

  } catch (error) {
    if (withdrawalId) {
      try {
        const snap =
          await withdrawalRef.get();

        if (
          snap.exists &&
          snap.data().status === "processing"
        ) {
          await db.runTransaction(async tx => {
            tx.update(userRef, {
              balance:
                FieldValue.increment(
                  withdrawalPoints
                ),

              updatedAt:
                FieldValue.serverTimestamp()
            });

            tx.update(withdrawalRef, {
              status: "failed",
              error: error.message,
              updatedAt:
                FieldValue.serverTimestamp()
            });
          });
        }
      } catch {}
    }

    throw error;
  }
}


// =====================================================
// ADMIN
// =====================================================

async function admin(req, res) {
  const { user } =
    validateInitData(getInitData(req));

  if (
    String(user.id) !==
    String(process.env.TELEGRAM_ADMIN_ID || "")
  ) {
    return jsonError(
      res,
      403,
      "Admin only"
    );
  }

  const action = String(
    req.body?.action || ""
  );

  if (action === "withdrawals") {
    const snap = await db
      .collection("withdrawals")
      .where(
        "status",
        "==",
        "processing"
      )
      .limit(100)
      .get();

    return res.json({
      success: true,

      withdrawals:
        snap.docs.map(d => ({
          id: d.id,
          ...d.data()
        }))
    });
  }

  if (action === "closeTask") {
    const taskId = String(
      req.body?.taskId || ""
    );

    if (!taskId) {
      throw new Error(
        "TASK_ID_REQUIRED"
      );
    }

    await db
      .collection("tasks")
      .doc(taskId)
      .update({
        status: "closed",
        updatedAt:
          FieldValue.serverTimestamp()
      });

    return res.json({
      success: true
    });
  }

  if (action === "stats") {
    const users = await db
      .collection("users")
      .count()
      .get();

    const tasks = await db
      .collection("tasks")
      .count()
      .get();

    return res.json({
      success: true,

      users:
        users.data().count,

      tasks:
        tasks.data().count
    });
  }

  throw new Error("UNKNOWN_ACTION");
}


// =====================================================
// ADMIN PAYOUT
// =====================================================

async function payout(req, res) {
  const adminId = String(
    req.body?.telegramId || ""
  );

  if (
    adminId !==
    String(process.env.TELEGRAM_ADMIN_ID || "")
  ) {
    return jsonError(
      res,
      403,
      "Forbidden"
    );
  }

  const withdrawalId = String(
    req.body?.withdrawalId || ""
  );

  if (!withdrawalId) {
    throw new Error(
      "WITHDRAWAL_ID_REQUIRED"
    );
  }

  const withdrawalRef = db
    .collection("withdrawals")
    .doc(withdrawalId);

  let alreadyPaid = null;

  await db.runTransaction(async tx => {
    const snap =
      await tx.get(withdrawalRef);

    if (!snap.exists) {
      throw new Error(
        "WITHDRAWAL_NOT_FOUND"
      );
    }

    const data = snap.data();

    if (data.status === "paid") {
      alreadyPaid = {
        txHash: data.txHash
      };

      return;
    }

    if (data.status !== "processing") {
      throw new Error(
        "WITHDRAWAL_NOT_PROCESSING"
      );
    }

    tx.update(withdrawalRef, {
      status: "paying",
      updatedAt:
        FieldValue.serverTimestamp()
    });
  });

  if (alreadyPaid) {
    return res.json({
      success: true,
      alreadyPaid: true,
      txHash: alreadyPaid.txHash
    });
  }

  const snap =
    await withdrawalRef.get();

  if (!snap.exists) {
    throw new Error(
      "WITHDRAWAL_NOT_FOUND"
    );
  }

  const data = snap.data();

  const payment = await sendUSDT(
    data.address,
    data.amountUSDT
  );

  await withdrawalRef.update({
    status: "paid",
    txHash: payment.txHash,
    paidAt:
      FieldValue.serverTimestamp()
  });

  return res.json({
    success: true,
    txHash: payment.txHash
  });
}


// =====================================================
// TELEGRAM WEBHOOK
// =====================================================

async function telegram(req, res) {
  const update = req.body;

  if (
    update?.message?.text?.trim() ===
    "/start"
  ) {
    const chatId =
      update.message.chat.id;

    const webAppUrl =
      process.env.WEBAPP_URL;

    if (!webAppUrl) {
      throw new Error(
        "WEBAPP_URL_MISSING"
      );
    }

    await sendMessage(
      chatId,

      "🔥 <b>Welcome to USDT Hub!</b>\n\nEarn points from ads, tasks and referrals, then withdraw your rewards.",

      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🚀 OPEN USDT HUB",

                web_app: {
                  url: webAppUrl
                }
              }
            ]
          ]
        }
      }
    );
  }

  return res.json({
    success: true
  });
}


// =====================================================
// MAIN VERCEL FUNCTION
// =====================================================

export default async function handler(req, res) {
  try {
    const path = getPath(req);
    const action = getAction(req);

    // -----------------------------------------------
    // Health check
    // -----------------------------------------------

    if (
      req.method === "GET" &&
      (path === "/" ||
       path === "/api" ||
       path === "/api/index")
    ) {
      return res.json({
        success: true,
        service: "USDT Hub API",
        status: "online"
      });
    }

    // -----------------------------------------------
    // Monetag callback
    // -----------------------------------------------

    if (
      path === "/api/ads" &&
      isMonetagPostback(req)
    ) {
      return await monetagPostback(
        req,
        res
      );
    }

    // -----------------------------------------------
    // Telegram webhook
    // -----------------------------------------------

    if (
      path === "/api/telegram"
    ) {
      return await telegram(
        req,
        res
      );
    }

    // -----------------------------------------------
    // All app API endpoints are POST
    // -----------------------------------------------

    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    // USER

    if (
      path === "/api/user" ||
      action === "user"
    ) {
      return await register(
        req,
        res
      );
    }

    // MEMBERSHIP

    if (
      path === "/api/verify-membership" ||
      action === "verify-membership"
    ) {
      return await verifyMembership(
        req,
        res
      );
    }

    // WELCOME

    if (
      path === "/api/claim-welcome" ||
      action === "claim-welcome"
    ) {
      return await claimWelcome(
        req,
        res
      );
    }

    // ADS

    if (path === "/api/ads") {
      return await rewardAd(
        req,
        res
      );
    }

    // GAMES

    if (path === "/api/games") {
      return await games(
        req,
        res
      );
    }

    // PROMO

    if (path === "/api/promo") {
      return await promo(
        req,
        res
      );
    }

    // REFERRAL

    if (path === "/api/referral") {
      return await referral(
        req,
        res
      );
    }

    // TASKS

    if (path === "/api/tasks") {
      return await tasks(
        req,
        res
      );
    }

    // WITHDRAW

    if (path === "/api/withdraw") {
      return await withdraw(
        req,
        res
      );
    }

    // ADMIN

    if (path === "/api/admin") {
      return await admin(
        req,
        res
      );
    }

    // PAYOUT

    if (path === "/api/payout") {
      return await payout(
        req,
        res
      );
    }

    return res.status(404).json({
      success: false,
      error: "API route not found"
    });

  } catch (error) {
    console.error(
      "USDT HUB API ERROR:",
      error
    );

    return res.status(400).json({
      success: false,
      error:
        error?.message ||
        "Request failed"
    });
  }
}
