import {
  db,
  FieldValue
} from "../lib/firebase.js";

import {
  validateInitData,
  getInitData
} from "../lib/auth.js";

import {
  getChatMember,
  sendMessage
} from "../lib/telegram.js";

import {
  sendUSDT
} from "../lib/payout.js";

import {
  CONFIG
} from "../lib/config.js";

import {
  ethers
} from "ethers";

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
  ].includes(
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
  return String(
    req.url?.split("?")[0] ||
    ""
  ).replace(/\/+$/, "");
}

function getTelegramUser(req) {
  return validateInitData(
    getInitData(req)
  );
}


// =====================================================
// USER
// =====================================================

async function register(req, res) {
  const {
    user,
    startParam
  } = getTelegramUser(req);

  const uid =
    String(user.id);

  const userRef =
    db.collection("users")
      .doc(uid);

  const existing =
    await userRef.get();

  if (existing.exists) {
    return res.json({
      success: true,
      newUser: false,
      user: existing.data()
    });
  }

  let inviterId = null;

  if (
    startParam?.startsWith("ref_")
  ) {
    const possible =
      startParam.slice(4);

    if (
      possible &&
      possible !== uid
    ) {
      const inviter =
        await db
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

    firstName:
      user.first_name || "",

    lastName:
      user.last_name || "",

    username:
      user.username || "",

    balance: 0,

    adsWatched: 0,
    monetagAds: 0,
    adsgramAds: 0,

    monetagToday: 0,
    adsgramToday: 0,

    adDate: today(),

    tasksCompleted: 0,

    referrals: 0,
    referralPoints: 0,

    welcomeBonusClaimed: false,
    welcomeBonusStatus: "none",
    welcomeAddress: null,

    channelsVerified: false,
    appUnlocked: false,

    withdrawals: 0,
    lastWithdrawalId: null,

    referralCode:
      `ref_${uid}`,

    referredBy:
      inviterId,

    createdAt:
      FieldValue.serverTimestamp(),

    updatedAt:
      FieldValue.serverTimestamp()
  };

  const batch =
    db.batch();

  batch.create(
    userRef,
    userData
  );

  if (inviterId) {
    const referralRef =
      db.collection("referrals")
        .doc(
          `${inviterId}_${uid}`
        );

    batch.create(
      referralRef,
      {
        inviterId,

        referredUserId:
          uid,

        channelReward:
          CONFIG.REFERRAL_CHANNEL,

        adsReward:
          CONFIG.REFERRAL_ADS,

        channelRewarded: false,
        adsRewarded: false,

        createdAt:
          FieldValue.serverTimestamp()
      }
    );

    batch.update(
      db.collection("users")
        .doc(inviterId),
      {
        referrals:
          FieldValue.increment(1),

        updatedAt:
          FieldValue.serverTimestamp()
      }
    );
  }

  await batch.commit();

  try {
    await sendMessage(
      uid,
      "🎉 <b>Welcome to USDT Hub!</b>\n\nYour account has been created successfully."
    );
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

async function verifyMembership(
  req,
  res
) {
  const {
    user
  } = getTelegramUser(req);

  const uid =
    String(user.id);

  const results =
    await Promise.all(
      CONFIG.CHANNELS.map(
        channel =>
          getChatMember(
            channel,
            uid
          )
      )
    );

  const joined =
    results.every(memberOK);

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

      updatedAt:
        FieldValue.serverTimestamp()
    });

  return res.json({
    success: true,
    joined: true
  });
}


// =====================================================
// WELCOME BONUS
// =====================================================

async function claimWelcome(
  req,
  res
) {
  const {
    user
  } = getTelegramUser(req);

  const uid =
    String(user.id);

  const address =
    String(
      req.body?.address || ""
    ).trim();

  if (
    !ethers.isAddress(address)
  ) {
    throw new Error(
      "INVALID_ADDRESS"
    );
  }

  const normalized =
    ethers.getAddress(
      address
    );

  const userRef =
    db.collection("users")
      .doc(uid);

  const addressRef =
    db.collection("welcomeClaims")
      .doc(
        normalized.toLowerCase()
      );

  const payoutRef =
    db.collection("payouts")
      .doc();

  await db.runTransaction(
    async tx => {
      const userSnap =
        await tx.get(userRef);

      const addressSnap =
        await tx.get(
          addressRef
        );

      if (!userSnap.exists) {
        throw new Error(
          "USER_NOT_FOUND"
        );
      }

      const u =
        userSnap.data();

      if (!u.channelsVerified) {
        throw new Error(
          "CHANNELS_REQUIRED"
        );
      }

      if (u.welcomeBonusClaimed) {
        throw new Error(
          "WELCOME_ALREADY_CLAIMED"
        );
      }

      if (addressSnap.exists) {
        throw new Error(
          "ADDRESS_ALREADY_USED"
        );
      }

      tx.create(
        addressRef,
        {
          userId: uid,
          address: normalized,
          payoutId: payoutRef.id,

          createdAt:
            FieldValue.serverTimestamp()
        }
      );

      tx.create(
        payoutRef,
        {
          type: "welcome",

          userId: uid,

          address: normalized,

          amount:
            CONFIG.WELCOME_USDT,

          status: "processing",

          createdAt:
            FieldValue.serverTimestamp()
        }
      );

      tx.update(
        userRef,
        {
          welcomeBonusClaimed: true,

          welcomeBonusStatus:
            "processing",

          welcomeAddress:
            normalized,

          appUnlocked: true,

          updatedAt:
            FieldValue.serverTimestamp()
        }
      );
    }
  );

  try {
    const payment =
      await sendUSDT(
        normalized,
        CONFIG.WELCOME_USDT
      );

    await payoutRef.update({
      status: "paid",

      txHash:
        payment.txHash,

      paidAt:
        FieldValue.serverTimestamp()
    });

    await userRef.update({
      welcomeBonusStatus: "paid",

      updatedAt:
        FieldValue.serverTimestamp()
    });

    return res.json({
      success: true,

      amount:
        CONFIG.WELCOME_USDT,

      txHash:
        payment.txHash
    });

  } catch (error) {
    await payoutRef.update({
      status: "failed",

      error:
        error.message,

      updatedAt:
        FieldValue.serverTimestamp()
    });

    await userRef.update({
      welcomeBonusStatus: "failed",

      updatedAt:
        FieldValue.serverTimestamp()
    });

    throw error;
  }
}


// =====================================================
// ADS
// =====================================================

async function rewardAd(
  req,
  res
) {
  const {
    user
  } = getTelegramUser(req);

  const uid =
    String(user.id);

  const provider =
    String(
      req.body?.provider || ""
    );

  if (
    ![
      "monetag",
      "adsgram"
    ].includes(provider)
  ) {
    throw new Error(
      "INVALID_PROVIDER"
    );
  }

  const userRef =
    db.collection("users")
      .doc(uid);

  const rewardRef =
    db.collection("adRewards")
      .doc();

  let result;

  await db.runTransaction(
    async tx => {
      const snap =
        await tx.get(userRef);

      if (!snap.exists) {
        throw new Error(
          "USER_NOT_FOUND"
        );
      }

      const u =
        snap.data();

      if (!u.channelsVerified) {
        throw new Error(
          "CHANNELS_REQUIRED"
        );
      }

      const d =
        today();

      let monetagToday =
        u.adDate === d
          ? Number(
              u.monetagToday || 0
            )
          : 0;

      let adsgramToday =
        u.adDate === d
          ? Number(
              u.adsgramToday || 0
            )
          : 0;

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

      if (
        provider === "monetag"
      ) {
        monetagToday++;
      } else {
        adsgramToday++;
      }

      tx.update(
        userRef,
        {
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

          adDate: d,

          updatedAt:
            FieldValue.serverTimestamp()
        }
      );

      tx.create(
        rewardRef,
        {
          userId: uid,

          provider,

          reward:
            CONFIG.AD_REWARD,

          date: d,

          createdAt:
            FieldValue.serverTimestamp()
        }
      );

      result = {
        reward:
          CONFIG.AD_REWARD,

        monetagToday,

        adsgramToday
      };
    }
  );

  return res.json({
    success: true,
    ...result
  });
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

async function promo(
  req,
  res
) {
  const {
    user
  } = getTelegramUser(req);

  const uid =
    String(user.id);

  const code =
    String(
      req.body?.code || ""
    )
      .trim()
      .toUpperCase();

  if (!CODES.includes(code)) {
    throw new Error(
      "INVALID_CODE"
    );
  }

  const claimRef =
    db.collection("promoClaims")
      .doc(
        `${uid}_${code}`
      );

  const userRef =
    db.collection("users")
      .doc(uid);

  await db.runTransaction(
    async tx => {
      const claim =
        await tx.get(claimRef);

      const userSnap =
        await tx.get(userRef);

      if (!userSnap.exists) {
        throw new Error(
          "USER_NOT_FOUND"
        );
      }

      if (claim.exists) {
        throw new Error(
          "ALREADY_CLAIMED"
        );
      }

      tx.create(
        claimRef,
        {
          userId: uid,
          code,

          reward:
            CONFIG.PROMO_REWARD,

          createdAt:
            FieldValue.serverTimestamp()
        }
      );

      tx.update(
        userRef,
        {
          balance:
            FieldValue.increment(
              CONFIG.PROMO_REWARD
            ),

          updatedAt:
            FieldValue.serverTimestamp()
        }
      );
    }
  );

  return res.json({
    success: true,

    reward:
      CONFIG.PROMO_REWARD
  });
}


// =====================================================
// REFERRALS
// =====================================================

async function referral(
  req,
  res
) {
  const {
    user
  } = getTelegramUser(req);

  const uid =
    String(user.id);

  const action =
    String(
      req.body?.action || ""
    );

  if (action === "list") {
    const snap =
      await db
        .collection("referrals")
        .where(
          "inviterId",
          "==",
          uid
        )
        .get();

    return res.json({
      success: true,

      referrals:
        snap.docs.map(
          doc => ({
            id: doc.id,
            ...doc.data()
          })
        )
    });
  }

  if (action === "check") {
    const snap =
      await db
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

    const refRef =
      snap.docs[0].ref;

    await db.runTransaction(
      async tx => {
        const refSnap =
          await tx.get(refRef);

        if (!refSnap.exists) {
          throw new Error(
            "REFERRAL_NOT_FOUND"
          );
        }

        const ref =
          refSnap.data();

        const referredRef =
          db.collection("users")
            .doc(uid);

        const inviterRef =
          db.collection("users")
            .doc(
              String(
                ref.inviterId
              )
            );

        const [
          referredSnap,
          inviterSnap
        ] = await Promise.all([
          tx.get(referredRef),
          tx.get(inviterRef)
        ]);

        if (
          !referredSnap.exists
        ) {
          throw new Error(
            "USER_NOT_FOUND"
          );
        }

        if (
          !inviterSnap.exists
        ) {
          throw new Error(
            "INVITER_NOT_FOUND"
          );
        }

        const u =
          referredSnap.data();

        const updates = {};

        let reward = 0;

        if (
          u.channelsVerified &&
          !ref.channelRewarded
        ) {
          updates.channelRewarded =
            true;

          reward +=
            Number(
              CONFIG.REFERRAL_CHANNEL
            );
        }

        if (
          Number(
            u.adsWatched || 0
          ) >= 2 &&
          !ref.adsRewarded
        ) {
          updates.adsRewarded =
            true;

          reward +=
            Number(
              CONFIG.REFERRAL_ADS
            );
        }

        if (reward > 0) {
          tx.update(
            inviterRef,
            {
              balance:
                FieldValue.increment(
                  reward
                ),

              referralPoints:
                FieldValue.increment(
                  reward
                ),

              updatedAt:
                FieldValue.serverTimestamp()
            }
          );
        }

        if (
          Object.keys(updates)
            .length
        ) {
          tx.update(
            refRef,
            updates
          );
        }
      }
    );

    return res.json({
      success: true
    });
  }

  throw new Error(
    "UNKNOWN_ACTION"
  );
}


// =====================================================
// TASKS
// =====================================================

async function tasks(
  req,
  res
) {
  const {
    user
  } = getTelegramUser(req);

  const uid =
    String(user.id);

  const action =
    String(
      req.body?.action || ""
    );

  if (action === "list") {
    const snap =
      await db
        .collection("tasks")
        .where(
          "status",
          "==",
          "active"
        )
        .limit(100)
        .get();

    return res.json({
      success: true,

      tasks:
        snap.docs.map(
          doc => ({
            id: doc.id,
            ...doc.data()
          })
        )
    });
  }

  if (action === "create") {
    const {
      title,
      link,
      chatId,
      type
    } = req.body;

    if (
      !title ||
      !link ||
      !chatId
    ) {
      throw new Error(
        "TASK_DATA_REQUIRED"
      );
    }

    if (
      ![
        "channel",
        "bot"
      ].includes(type)
    ) {
      throw new Error(
        "INVALID_TASK_TYPE"
      );
    }

    const userRef =
      db.collection("users")
        .doc(uid);

    const taskRef =
      db.collection("tasks")
        .doc();

    await db.runTransaction(
      async tx => {
        const snap =
          await tx.get(userRef);

        if (!snap.exists) {
          throw new Error(
            "USER_NOT_FOUND"
          );
        }

        const u =
          snap.data();

        const isAdmin =
          uid ===
          String(
            process.env
              .TELEGRAM_ADMIN_ID ||
            ""
          );

        const balance =
          Number(
            u.balance || 0
          );

        if (
          !isAdmin &&
          balance <
            CONFIG.TASK_CREATE_COST
        ) {
          throw new Error(
            "INSUFFICIENT_POINTS"
          );
        }

        if (!isAdmin) {
          tx.update(
            userRef,
            {
              balance:
                FieldValue.increment(
                  -CONFIG.TASK_CREATE_COST
                ),

              updatedAt:
                FieldValue.serverTimestamp()
            }
          );
        }

        tx.create(
          taskRef,
          {
            ownerId: uid,

            title:
              String(title)
                .slice(0, 120),

            link:
              String(link)
                .slice(0, 500),

            chatId:
              String(chatId),

            type,

            reward:
              CONFIG.TASK_REWARD,

            completions: 0,

            maxCompletions:
              CONFIG.TASK_LIMIT,

            status:
              "active",

            createdAt:
              FieldValue.serverTimestamp(),

            updatedAt:
              FieldValue.serverTimestamp()
          }
        );
      }
    );

    return res.json({
      success: true,

      taskId:
        taskRef.id
    });
  }

  if (action === "complete") {
    const taskId =
      String(
        req.body?.taskId || ""
      );

    if (!taskId) {
      throw new Error(
        "TASK_ID_REQUIRED"
      );
    }

    const taskRef =
      db.collection("tasks")
        .doc(taskId);

    const completionRef =
      db.collection(
        "taskCompletions"
      )
        .doc(
          `${uid}_${taskId}`
        );

    const userRef =
      db.collection("users")
        .doc(uid);

    const taskSnap =
      await taskRef.get();

    if (!taskSnap.exists) {
      throw new Error(
        "TASK_NOT_FOUND"
      );
    }

    const task =
      taskSnap.data();

    const member =
      await getChatMember(
        task.chatId,
        uid
      );

    if (!memberOK(member)) {
      throw new Error(
        "TELEGRAM_MEMBERSHIP_REQUIRED"
      );
    }

    let reward = 0;

    await db.runTransaction(
      async tx => {
        const [
          freshTask,
          completion,
          userSnap
        ] = await Promise.all([
          tx.get(taskRef),
          tx.get(completionRef),
          tx.get(userRef)
        ]);

        if (!freshTask.exists) {
          throw new Error(
            "TASK_NOT_FOUND"
          );
        }

        if (!userSnap.exists) {
          throw new Error(
            "USER_NOT_FOUND"
          );
        }

        if (completion.exists) {
          throw new Error(
            "ALREADY_COMPLETED"
          );
        }

        const t =
          freshTask.data();

        if (
          t.status !== "active"
        ) {
          throw new Error(
            "TASK_CLOSED"
          );
        }

        const current =
          Number(
            t.completions || 0
          );

        if (
          current >=
          CONFIG.TASK_LIMIT
        ) {
          throw new Error(
            "TASK_FULL"
          );
        }

        reward =
          Number(
            CONFIG.TASK_REWARD
          );

        const next =
          current + 1;

        tx.create(
          completionRef,
          {
            userId: uid,
            taskId,
            reward,

            createdAt:
              FieldValue.serverTimestamp()
          }
        );

        tx.update(
          taskRef,
          {
            completions: next,

            status:
              next >=
              CONFIG.TASK_LIMIT
                ? "completed"
                : "active",

            updatedAt:
              FieldValue.serverTimestamp()
          }
        );

        tx.update(
          userRef,
          {
            balance:
              FieldValue.increment(
                reward
              ),

            tasksCompleted:
              FieldValue.increment(1),

            updatedAt:
              FieldValue.serverTimestamp()
          }
        );
      }
    );

    return res.json({
      success: true,
      reward
    });
  }

  throw new Error(
    "UNKNOWN_ACTION"
  );
}


// =====================================================
// WITHDRAW
// =====================================================

async function withdraw(
  req,
  res
) {
  const {
    user
  } = getTelegramUser(req);

  const uid =
    String(user.id);

  const address =
    String(
      req.body?.address || ""
    ).trim();

  if (
    !ethers.isAddress(address)
  ) {
    throw new Error(
      "INVALID_ADDRESS"
    );
  }

  const destination =
    ethers.getAddress(
      address
    );

  const userRef =
    db.collection("users")
      .doc(uid);

  const withdrawalRef =
    db.collection("withdrawals")
      .doc();

  const points =
    Number(
      CONFIG.WITHDRAW_MIN_POINTS
    );

  const amount =
    points /
    Number(
      CONFIG.POINTS_PER_USDT
    );

  await db.runTransaction(
    async tx => {
      const snap =
        await tx.get(userRef);

      if (!snap.exists) {
        throw new Error(
          "USER_NOT_FOUND"
        );
      }

      const u =
        snap.data();

      if (!u.channelsVerified) {
        throw new Error(
          "CHANNELS_REQUIRED"
        );
      }

      if (
        Number(u.balance || 0) <
        points
      ) {
        throw new Error(
          "MINIMUM_NOT_REACHED"
        );
      }

      tx.update(
        userRef,
        {
          balance:
            FieldValue.increment(
              -points
            ),

          withdrawals:
            FieldValue.increment(1),

          lastWithdrawalId:
            withdrawalRef.id,

          updatedAt:
            FieldValue.serverTimestamp()
        }
      );

      tx.create(
        withdrawalRef,
        {
          userId: uid,

          address:
            destination,

          points,

          amountUSDT:
            Number(
              amount.toFixed(8)
            ),

          status:
            "processing",

          createdAt:
            FieldValue.serverTimestamp()
        }
      );
    }
  );

  try {
    const payment =
      await sendUSDT(
        destination,
        Number(
          amount.toFixed(8)
        )
      );

    await withdrawalRef.update({
      status: "paid",

      txHash:
        payment.txHash,

      paidAt:
        FieldValue.serverTimestamp()
    });

    return res.json({
      success: true,

      amount:
        Number(
          amount.toFixed(8)
        ),

      points,

      txHash:
        payment.txHash
    });

  } catch (error) {
    await db.runTransaction(
      async tx => {
        const snap =
          await tx.get(
            withdrawalRef
          );

        if (
          snap.exists &&
          snap.data().status ===
            "processing"
        ) {
          tx.update(
            userRef,
            {
              balance:
                FieldValue.increment(
                  points
                ),

              updatedAt:
                FieldValue.serverTimestamp()
            }
          );

          tx.update(
            withdrawalRef,
            {
              status: "failed",

              error:
                error.message,

              updatedAt:
                FieldValue.serverTimestamp()
            }
          );
        }
      }
    );

    throw error;
  }
}


// =====================================================
// ADMIN
// =====================================================

async function admin(
  req,
  res
) {
  const {
    user
  } = getTelegramUser(req);

  if (
    String(user.id) !==
    String(
      process.env
        .TELEGRAM_ADMIN_ID
    )
  ) {
    return res.status(403).json({
      success: false,
      error: "ADMIN_ONLY"
    });
  }

  const action =
    String(
      req.body?.action || ""
    );

  if (
    action ===
    "withdrawals"
  ) {
    const snap =
      await db
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
        snap.docs.map(
          d => ({
            id: d.id,
            ...d.data()
          })
        )
    });
  }

  if (
    action === "stats"
  ) {
    const users =
      await db
        .collection("users")
        .count()
        .get();

    const tasks =
      await db
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

  if (
    action === "closeTask"
  ) {
    const taskId =
      String(
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

  throw new Error(
    "UNKNOWN_ACTION"
  );
}


// =====================================================
// ADMIN PAYOUT
// =====================================================

async function payout(
  req,
  res
) {
  const {
    user
  } = getTelegramUser(req);

  if (
    String(user.id) !==
    String(
      process.env
        .TELEGRAM_ADMIN_ID
    )
  ) {
    return res.status(403).json({
      success: false,
      error: "FORBIDDEN"
    });
  }

  const withdrawalId =
    String(
      req.body?.withdrawalId || ""
    );

  if (!withdrawalId) {
    throw new Error(
      "WITHDRAWAL_ID_REQUIRED"
    );
  }

  const withdrawalRef =
    db.collection("withdrawals")
      .doc(withdrawalId);

  const snap =
    await withdrawalRef.get();

  if (!snap.exists) {
    throw new Error(
      "WITHDRAWAL_NOT_FOUND"
    );
  }

  const data =
    snap.data();

  if (
    data.status === "paid"
  ) {
    return res.json({
      success: true,

      alreadyPaid: true,

      txHash:
        data.txHash
    });
  }

  if (
    data.status !==
    "processing"
  ) {
    throw new Error(
      "WITHDRAWAL_NOT_PROCESSING"
    );
  }

  await withdrawalRef.update({
    status: "paying",

    updatedAt:
      FieldValue.serverTimestamp()
  });

  try {
    const payment =
      await sendUSDT(
        data.address,
        data.amountUSDT
      );

    await withdrawalRef.update({
      status: "paid",

      txHash:
        payment.txHash,

      paidAt:
        FieldValue.serverTimestamp()
    });

    return res.json({
      success: true,

      txHash:
        payment.txHash
    });

  } catch (error) {
    await withdrawalRef.update({
      status: "processing",

      error:
        error.message,

      updatedAt:
        FieldValue.serverTimestamp()
    });

    throw error;
  }
}


// =====================================================
// TELEGRAM WEBHOOK
// =====================================================

async function telegram(
  req,
  res
) {
  const update =
    req.body;

  if (
    update?.message?.text
      ?.trim()
      .startsWith("/start")
  ) {
    const chatId =
      update.message.chat.id;

    const webAppUrl =
      process.env.WEBAPP_URL;

    await sendMessage(
      chatId,

      "🔥 <b>Welcome to USDT Hub!</b>\n\nEarn from ads, tasks and referrals.",

      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  "🚀 OPEN USDT HUB",

                web_app: {
                  url:
                    webAppUrl
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
// MAIN
// =====================================================

export default async function handler(
  req,
  res
) {
  try {
    const path =
      getPath(req);

    const action =
      getAction(req);

    if (
      path === "/api/telegram"
    ) {
      return telegram(
        req,
        res
      );
    }

    if (
      req.method !== "POST"
    ) {
      return res.status(405).json({
        success: false,
        error:
          "Method not allowed"
      });
    }

    if (
      path === "/api/user" ||
      action === "user"
    ) {
      return register(
        req,
        res
      );
    }

    if (
      path ===
        "/api/verify-membership" ||
      action ===
        "verify-membership"
    ) {
      return verifyMembership(
        req,
        res
      );
    }

    if (
      path ===
        "/api/claim-welcome" ||
      action ===
        "claim-welcome"
    ) {
      return claimWelcome(
        req,
        res
      );
    }

    if (
      path === "/api/ads"
    ) {
      return rewardAd(
        req,
        res
      );
    }

    if (
      path === "/api/promo"
    ) {
      return promo(
        req,
        res
      );
    }

    if (
      path === "/api/referral"
    ) {
      return referral(
        req,
        res
      );
    }

    if (
      path === "/api/tasks"
    ) {
      return tasks(
        req,
        res
      );
    }

    if (
      path === "/api/withdraw"
    ) {
      return withdraw(
        req,
        res
      );
    }

    if (
      path === "/api/admin"
    ) {
      return admin(
        req,
        res
      );
    }

    if (
      path === "/api/payout"
    ) {
      return payout(
        req,
        res
      );
    }

    return res.status(404).json({
      success: false,
      error:
        "API route not found"
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
