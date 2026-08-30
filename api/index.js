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

import {
  sendUSDT,
  getPayoutWalletInfo
} from "../lib/payout.js";

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


function getVipTier(totalPts = 0) {
  const tiers = Object.values(CONFIG.VIP_TIERS)
    .sort((a, b) => b.minPts - a.minPts);

  for (const tier of tiers) {
    if (totalPts >= tier.minPts) {
      return tier;
    }
  }

  return CONFIG.VIP_TIERS.BRONZE;
}


/* =========================================================
   USER
========================================================= */

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

    const vip = getVipTier(
      Number(userData.balance || 0)
    );

    return res.status(200).json({
      success: true,
      newUser: false,

      user: {
        ...userData,

        vipTier: vip.name,
        vipMultiplier: vip.multiplier,

        botUsername: CONFIG.BOT_USERNAME,

        isAdmin:
          uid === String(CONFIG.ADMIN_ID)
      }
    });
  }


  /* -----------------------------
     REFERRAL
  ----------------------------- */

  let inviterId = null;

  if (
    startParam &&
    String(startParam).startsWith("ref_")
  ) {
    const possible =
      String(startParam)
        .slice(4)
        .trim();

    if (
      possible &&
      possible !== uid
    ) {
      const inviterDoc =
        await db
          .collection("users")
          .doc(possible)
          .get();

      if (inviterDoc.exists) {
        inviterId = possible;
      }
    }
  }


  /* -----------------------------
     NEW USER
  ----------------------------- */

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

    withdrawals: 0,
    lastWithdrawalId: null,

    referralCode: `ref_${uid}`,

    referredBy: inviterId,

    createdAt:
      FieldValue.serverTimestamp(),

    updatedAt:
      FieldValue.serverTimestamp()
  };


  const batch = db.batch();

  batch.create(
    userRef,
    userData
  );


  if (inviterId) {

    const referralRef =
      db
        .collection("referrals")
        .doc(`${inviterId}_${uid}`);


    batch.create(
      referralRef,
      {
        inviterId,

        referredUserId: uid,

        channelRewarded: false,

        adsRewarded: false,

        createdAt:
          FieldValue.serverTimestamp()
      }
    );


    batch.update(
      db
        .collection("users")
        .doc(inviterId),
      {
        referrals:
          FieldValue.increment(1),

        updatedAt:
          FieldValue.serverTimestamp()
      }
    );


    notifyNewReferral(
      inviterId,
      user.first_name || "New Explorer"
    );
  }


  await batch.commit();


  return res.status(200).json({
    success: true,
    newUser: true,

    user: {
      ...userData,

      vipTier: "Bronze",
      vipMultiplier: 1.0,

      botUsername:
        CONFIG.BOT_USERNAME,

      isAdmin:
        uid === String(CONFIG.ADMIN_ID)
    }
  });
}


/* =========================================================
   DAILY STREAK
========================================================= */

async function claimStreak(req, res) {

  const { user } = getUser(req);

  const uid = String(user.id);

  const userRef =
    db.collection("users").doc(uid);

  const dToday = today();
  const dYesterday = yesterday();

  let streakReward = 0;
  let newStreak = 1;


  await db.runTransaction(
    async tx => {

      const snap =
        await tx.get(userRef);

      if (!snap.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      const u = snap.data();


      if (
        u.lastStreakDate === dToday
      ) {
        throw new Error(
          "STREAK_ALREADY_CLAIMED_TODAY"
        );
      }


      if (
        u.lastStreakDate === dYesterday
      ) {
        newStreak =
          ((u.streakDay || 0) % 7) + 1;
      } else {
        newStreak = 1;
      }


      streakReward =
        CONFIG.DAILY_STREAK_REWARDS[
          newStreak - 1
        ] || 50;


      tx.update(
        userRef,
        {
          balance:
            FieldValue.increment(
              streakReward
            ),

          streakDay:
            newStreak,

          lastStreakDate:
            dToday,

          updatedAt:
            FieldValue.serverTimestamp()
        }
      );
    }
  );


  return res.status(200).json({
    success: true,
    streakDay: newStreak,
    reward: streakReward
  });
}


/* =========================================================
   MANDATORY CHANNEL VERIFICATION
========================================================= */

async function verifyMembership(req, res) {

  const { user } = getUser(req);

  const uid = String(user.id);


  /*
   * Check EVERY channel.
   *
   * If there are 2 channels:
   *
   * Channel 1 = joined
   * Channel 2 = joined
   *
   * Only then:
   *
   * joined = true
   */

  const results =
    await Promise.all(
      CONFIG.CHANNELS.map(
        async channel => {

          const member =
            await getChatMember(
              channel,
              uid
            );

          return {
            channel,

            joined:
              memberOK(member),

            status:
              member?.status ||
              "unknown"
          };
        }
      )
    );


  const joined =
    results.length > 0 &&
    results.every(
      result => result.joined
    );


  /*
   * ONE CHANNEL NOT JOINED
   * = APP REMAINS LOCKED
   */

  if (!joined) {

    return res.status(200).json({
      success: true,

      joined: false,

      channels: results,

      requiredChannels:
        CONFIG.CHANNELS
    });
  }


  const userRef =
    db.collection("users").doc(uid);

  const userDoc =
    await userRef.get();


  if (!userDoc.exists) {
    throw new Error("USER_NOT_FOUND");
  }


  const u = userDoc.data();


  await userRef.set(
    {
      channelsVerified: true,
      appUnlocked: true,

      updatedAt:
        FieldValue.serverTimestamp()
    },
    {
      merge: true
    }
  );


  /* -----------------------------
     REFERRAL CHANNEL BONUS
  ----------------------------- */

  if (u.referredBy) {

    const refDocRef =
      db
        .collection("referrals")
        .doc(`${u.referredBy}_${uid}`);


    const refSnap =
      await refDocRef.get();


    if (
      refSnap.exists &&
      !refSnap.data().channelRewarded
    ) {

      await db.runTransaction(
        async tx => {

          const freshRef =
            await tx.get(refDocRef);

          if (!freshRef.exists) {
            return;
          }

          const referralData =
            freshRef.data();


          if (
            referralData.channelRewarded
          ) {
            return;
          }


          tx.update(
            refDocRef,
            {
              channelRewarded: true,

              updatedAt:
                FieldValue.serverTimestamp()
            }
          );


          tx.update(
            db
              .collection("users")
              .doc(u.referredBy),
            {
              balance:
                FieldValue.increment(
                  CONFIG.REFERRAL_CHANNEL_JOIN
                ),

              referralPoints:
                FieldValue.increment(
                  CONFIG.REFERRAL_CHANNEL_JOIN
                ),

              updatedAt:
                FieldValue.serverTimestamp()
            }
          );
        }
      );


      notifyReferralBonus(
        u.referredBy,

        "Referral joined both mandatory channels",

        CONFIG.REFERRAL_CHANNEL_JOIN
      );
    }
  }


  return res.status(200).json({

    success: true,

    joined: true,

    channels: results,

    requiredChannels:
      CONFIG.CHANNELS
  });
}


/* =========================================================
   WELCOME BONUS
========================================================= */

async function claimWelcome(req, res) {

  const { user } =
    getUser(req);

  const uid = String(user.id);

  const address =
    String(
      req.body?.address || ""
    ).trim();


  if (!ethers.isAddress(address)) {
    throw new Error(
      "INVALID_ADDRESS"
    );
  }


  const normalized =
    ethers.getAddress(address);


  const userRef =
    db.collection("users").doc(uid);


  const addressRef =
    db
      .collection("welcomeClaims")
      .doc(
        normalized.toLowerCase()
      );


  const payoutRef =
    db
      .collection("payouts")
      .doc();


  await db.runTransaction(
    async tx => {

      const userSnap =
        await tx.get(userRef);

      const addressSnap =
        await tx.get(addressRef);


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


      tx.set(
        addressRef,
        {
          userId: uid,

          address: normalized,

          payoutId:
            payoutRef.id,

          createdAt:
            FieldValue.serverTimestamp()
        }
      );


      tx.set(
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


    await payoutRef.update(
      {
        status: "paid",

        txHash:
          payment.txHash,

        paidAt:
          FieldValue.serverTimestamp()
      }
    );


    await userRef.update(
      {
        welcomeBonusStatus:
          "paid",

        updatedAt:
          FieldValue.serverTimestamp()
      }
    );


    notifyWelcomeBonus(
      uid,

      CONFIG.WELCOME_USDT,

      payment.txHash
    );


    broadcastPaymentProof(
      {
        type: "welcome",

        userId: uid,

        amountUSDT:
          CONFIG.WELCOME_USDT,

        txHash:
          payment.txHash,

        address: normalized
      }
    );


    return res.status(200).json({

      success: true,

      amount:
        CONFIG.WELCOME_USDT,

      txHash:
        payment.txHash
    });

  } catch (error) {

    await payoutRef.update(
      {
        status: "failed",

        error:
          error?.message ||
          String(error),

        updatedAt:
          FieldValue.serverTimestamp()
      }
    );


    await userRef.update(
      {
        welcomeBonusStatus:
          "failed",

        updatedAt:
          FieldValue.serverTimestamp()
      }
    );


    throw error;
  }
}


/* =========================================================
   ADS
========================================================= */

async function ads(req, res) {

  const { user } =
    getUser(req);

  const uid = String(user.id);

  const provider =
    String(
      req.body?.provider || ""
    ).toLowerCase();


  if (
    ![
      "monetag",
      "adsgram",
      "hilltop"
    ].includes(provider)
  ) {
    throw new Error(
      "INVALID_PROVIDER"
    );
  }


  const userRef =
    db.collection("users").doc(uid);

  const d = today();


  let result;

  let shouldRewardInviter = false;

  let inviterId = null;


  const HILLTOP_LIMIT =
    CONFIG.HILLTOP_LIMIT || 15;

  const monetagLimit =
    CONFIG.MONETAG_LIMIT || 30;

  const adsgramLimit =
    CONFIG.ADSGRAM_LIMIT || 25;


  await db.runTransaction(
    async tx => {

      const snap =
        await tx.get(userRef);


      if (!snap.exists) {
        throw new Error(
          "USER_NOT_FOUND"
        );
      }


      const u = snap.data();


      /*
       * Mandatory channels
       */

      if (!u.channelsVerified) {
        throw new Error(
          "CHANNELS_REQUIRED"
        );
      }


      let monetagToday =
        u.adDate === d
          ? Number(u.monetagToday || 0)
          : 0;


      let adsgramToday =
        u.adDate === d
          ? Number(u.adsgramToday || 0)
          : 0;


      let hilltopToday =
        u.adDate === d
          ? Number(u.hilltopToday || 0)
          : 0;


      if (
        provider === "monetag" &&
        monetagToday >= monetagLimit
      ) {
        throw new Error(
          "MONETAG_LIMIT"
        );
      }


      if (
        provider === "adsgram" &&
        adsgramToday >= adsgramLimit
      ) {
        throw new Error(
          "ADSGRAM_LIMIT"
        );
      }


      if (
        provider === "hilltop" &&
        hilltopToday >= HILLTOP_LIMIT
      ) {
        throw new Error(
          "HILLTOP_LIMIT"
        );
      }


      if (provider === "monetag") {
        monetagToday++;
      } else if (
        provider === "adsgram"
      ) {
        adsgramToday++;
      } else {
        hilltopToday++;
      }


      const totalAds =
        Number(u.adsWatched || 0) + 1;


      const vip =
        getVipTier(
          Number(u.balance || 0)
        );


      const finalReward =
        Math.round(
          CONFIG.AD_REWARD *
          vip.multiplier
        );


      tx.update(
        userRef,
        {
          balance:
            FieldValue.increment(
              finalReward
            ),

          adsWatched:
            FieldValue.increment(1),

          [`${provider}Ads`]:
            FieldValue.increment(1),

          monetagToday,

          adsgramToday,

          hilltopToday,

          adDate: d,

          updatedAt:
            FieldValue.serverTimestamp()
        }
      );


      if (
        u.referredBy &&
        totalAds >= 2
      ) {

        shouldRewardInviter = true;

        inviterId =
          u.referredBy;
      }


      result = {

        reward:
          finalReward,

        monetagToday,

        adsgramToday,

        hilltopToday,

        totalAds
      };
    }
  );


  /* -----------------------------
     REFERRAL ADS BONUS
  ----------------------------- */

  if (
    shouldRewardInviter &&
    inviterId
  ) {

    const refDocRef =
      db
        .collection("referrals")
        .doc(`${inviterId}_${uid}`);


    const refSnap =
      await refDocRef.get();


    if (
      refSnap.exists &&
      !refSnap.data().adsRewarded
    ) {

      await db.runTransaction(
        async tx => {

          const freshRef =
            await tx.get(refDocRef);


          if (!freshRef.exists) {
            return;
          }


          if (
            freshRef.data().adsRewarded
          ) {
            return;
          }


          tx.update(
            refDocRef,
            {
              adsRewarded: true,

              updatedAt:
                FieldValue.serverTimestamp()
            }
          );


          tx.update(
            db
              .collection("users")
              .doc(inviterId),
            {
              balance:
                FieldValue.increment(
                  CONFIG.REFERRAL_ADS_WATCHED
                ),

              referralPoints:
                FieldValue.increment(
                  CONFIG.REFERRAL_ADS_WATCHED
                ),

              updatedAt:
                FieldValue.serverTimestamp()
            }
          );
        }
      );


      notifyReferralBonus(
        inviterId,

        "Referral watched 2 ads",

        CONFIG.REFERRAL_ADS_WATCHED
      );
    }
  }


  return res.status(200).json({
    success: true,
    ...result
  });
}


/* =========================================================
   DEPOSIT
========================================================= */

async function deposit(req, res) {

  const { user } =
    getUser(req);

  const uid = String(user.id);

  const action =
    String(
      req.body?.action || ""
    ).toLowerCase();


  if (action === "info") {

    return res.status(200).json({

      success: true,

      depositAddress:
        CONFIG.DEPOSIT_ADDRESS,

      pointsPerUSDT:
        CONFIG.POINTS_PER_USDT
    });
  }


  if (action === "submit") {

    const txHash =
      String(
        req.body?.txHash || ""
      ).trim();


    if (
      !txHash ||
      txHash.length < 10
    ) {
      throw new Error(
        "INVALID_TX_HASH"
      );
    }


    const depositRef =
      db
        .collection("deposits")
        .doc(txHash.toLowerCase());


    await db.runTransaction(
      async tx => {

        const snap =
          await tx.get(depositRef);


        if (snap.exists) {
          throw new Error(
            "TX_ALREADY_SUBMITTED"
          );
        }


        tx.create(
          depositRef,
          {
            userId: uid,

            txHash:
              txHash.toLowerCase(),

            status: "pending",

            createdAt:
              FieldValue.serverTimestamp()
          }
        );
      }
    );


    return res.status(200).json({

      success: true,

      message:
        "Deposit submitted for blockchain verification"
    });
  }


  throw new Error(
    "UNKNOWN_DEPOSIT_ACTION"
  );
}


/* =========================================================
   PROMO
========================================================= */

async function promo(req, res) {

  const { user } =
    getUser(req);

  const uid = String(user.id);


  const code =
    String(
      req.body?.code || ""
    )
      .trim()
      .toUpperCase();


  if (
    !CONFIG.PROMO_CODES.includes(code)
  ) {
    throw new Error(
      "INVALID_CODE"
    );
  }


  const claimRef =
    db
      .collection("promoClaims")
      .doc(`${uid}_${code}`);


  const userRef =
    db.collection("users").doc(uid);


  await db.runTransaction(
    async tx => {

      const claim =
        await tx.get(claimRef);

      const u =
        await tx.get(userRef);


      if (!u.exists) {
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


  return res.status(200).json({

    success: true,

    reward:
      CONFIG.PROMO_REWARD
  });
}


/* =========================================================
   REFERRALS
========================================================= */

async function referral(req, res) {

  const { user } =
    getUser(req);

  const uid = String(user.id);


  const action =
    String(
      req.body?.action || ""
    ).toLowerCase();


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


    return res.status(200).json({

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


  if (action === "leaderboard") {

    const snap =
      await db
        .collection("users")
        .orderBy(
          "referrals",
          "desc"
        )
        .limit(10)
        .get();


    return res.status(200).json({

      success: true,

      leaderboard:
        snap.docs.map(
          doc => {

            const d =
              doc.data();


            return {

              firstName:
                d.firstName ||
                "User",

              referrals:
                d.referrals || 0,

              referralPoints:
                d.referralPoints || 0
            };
          }
        )
    });
  }


  throw new Error(
    "UNKNOWN_ACTION"
  );
}


/* =========================================================
   TASKS
========================================================= */

async function tasks(req, res) {

  const { user } =
    getUser(req);

  const uid = String(user.id);


  const action =
    String(
      req.body?.action || ""
    ).toLowerCase();


  if (action === "list") {

    const tasksSnap =
      await db
        .collection("tasks")
        .where(
          "status",
          "==",
          "active"
        )
        .limit(100)
        .get();


    const completedSnap =
      await db
        .collection("taskCompletions")
        .where(
          "userId",
          "==",
          uid
        )
        .get();


    const completedTaskIds =
      new Set(
        completedSnap.docs.map(
          doc =>
            doc.data().taskId
        )
      );


    const availableTasks =
      tasksSnap.docs
        .map(
          doc => ({
            id: doc.id,
            ...doc.data()
          })
        )
        .filter(
          task =>
            !completedTaskIds.has(
              task.id
            )
        );


    return res.status(200).json({

      success: true,

      tasks:
        availableTasks
    });
  }


  /* -----------------------------
     CREATE TASK
  ----------------------------- */

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


    const taskRef =
      db.collection("tasks").doc();


    const userRef =
      db.collection("users").doc(uid);


    await db.runTransaction(
      async tx => {

        const userSnap =
          await tx.get(userRef);


        if (!userSnap.exists) {
          throw new Error(
            "USER_NOT_FOUND"
          );
        }


        const u =
          userSnap.data();


        const isAdmin =
          uid ===
          String(CONFIG.ADMIN_ID);


        if (
          !isAdmin &&
          Number(u.balance || 0) <
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

            type:
              String(
                type || "channel"
              ),

            reward:
              CONFIG.TASK_REWARD,

            completions: 0,

            maxCompletions:
              CONFIG.TASK_LIMIT,

            status: "active",

            createdAt:
              FieldValue.serverTimestamp(),

            updatedAt:
              FieldValue.serverTimestamp()
          }
        );
      }
    );


    return res.status(200).json({

      success: true,

      taskId:
        taskRef.id
    });
  }


  /* -----------------------------
     COMPLETE TASK
  ----------------------------- */

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
      db
        .collection("tasks")
        .doc(taskId);


    const completionRef =
      db
        .collection("taskCompletions")
        .doc(`${uid}_${taskId}`);


    const userRef =
      db
        .collection("users")
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


    if (
      task.status !== "active"
    ) {
      throw new Error(
        "TASK_CLOSED"
      );
    }


    let reward = 0;


    await db.runTransaction(
      async tx => {

        const freshTask =
          await tx.get(taskRef);

        const completion =
          await tx.get(completionRef);

        const userSnap =
          await tx.get(userRef);


        if (
          !freshTask.exists ||
          !userSnap.exists
        ) {
          throw new Error(
            "NOT_FOUND"
          );
        }


        if (completion.exists) {
          throw new Error(
            "ALREADY_COMPLETED"
          );
        }


        reward =
          Number(
            CONFIG.TASK_REWARD
          );


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


        /*
         * Keep your existing behavior:
         * task disappears after completion.
         */
        tx.delete(taskRef);
      }
    );


    return res.status(200).json({

      success: true,

      reward
    });
  }


  throw new Error(
    "UNKNOWN_ACTION"
  );
}


/* =========================================================
   WITHDRAW
========================================================= */

async function withdraw(req, res) {

  const { user } =
    getUser(req);

  const uid = String(user.id);


  const address =
    String(
      req.body?.address || ""
    ).trim();


  if (!ethers.isAddress(address)) {
    throw new Error(
      "INVALID_ADDRESS"
    );
  }


  const destination =
    ethers.getAddress(address);


  const minPoints =
    Number(
      CONFIG.WITHDRAW_MIN_POINTS
    );


  const pointsPerUSDT =
    Number(
      CONFIG.POINTS_PER_USDT
    );


  const amount =
    minPoints /
    pointsPerUSDT;


  const userRef =
    db.collection("users").doc(uid);


  const withdrawalRef =
    db
      .collection("withdrawals")
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


      if (!u.channelsVerified) {
        throw new Error(
          "CHANNELS_REQUIRED"
        );
      }


      if (
        Number(u.balance || 0) <
        minPoints
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
              -minPoints
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

          points:
            minPoints,

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


    await withdrawalRef.update(
      {
        status: "paid",

        txHash:
          payment.txHash,

        paidAt:
          FieldValue.serverTimestamp()
      }
    );


    notifyWithdrawalSuccess(
      uid,

      amount.toFixed(2),

      payment.txHash
    );


    broadcastPaymentProof(
      {
        type: "withdraw",

        userId: uid,

        amountUSDT:
          Number(
            amount.toFixed(2)
          ),

        txHash:
          payment.txHash,

        address:
          destination
      }
    );


    return res.status(200).json({

      success: true,

      amount:
        Number(
          amount.toFixed(8)
        ),

      points:
        minPoints,

      txHash:
        payment.txHash
    });

  } catch (error) {

    await db.runTransaction(
      async tx => {

        tx.update(
          userRef,
          {
            balance:
              FieldValue.increment(
                minPoints
              ),

            updatedAt:
              FieldValue.serverTimestamp()
          }
        );


        tx.update(
          withdrawalRef,
          {
            status:
              "failed",

            error:
              error?.message ||
              String(error),

            updatedAt:
              FieldValue.serverTimestamp()
          }
        );
      }
    );


    throw error;
  }
}


/* =========================================================
   TELEGRAM BOT
========================================================= */

async function telegram(req, res) {

  const update =
    req.body || {};


  if (
    update?.message?.text
      ?.startsWith("/start")
  ) {

    const chatId =
      update.message.chat.id;


    const firstName =
      update.message.from
        ?.first_name ||
      "Trader";


    const text =
      update.message.text.trim();


    const parts =
      text.split(" ");


    const startParam =
      parts.length > 1
        ? parts[1]
        : "";


    const baseUrl =
      CONFIG.WEBAPP_URL;


    const launchUrl =
      startParam
        ? `${baseUrl}?startapp=${encodeURIComponent(startParam)}`
        : baseUrl;


    const welcomeMessage = [

      `💎 <b>WELCOME TO USDT HUB, ${String(firstName).toUpperCase()}!</b> 💎`,

      `<i>The #1 Automated Micro-Earning Hub on Telegram.</i>`,

      ``,

      `━━━━━━━━━━━━━━━━━━━━`,

      `🎁 <b>0.01 USDT Welcome Gift:</b> Instant BEP20 blockchain payout`,

      `📺 <b>Daily Ad Mining:</b> Earn PTS from available ad providers`,

      `👥 <b>Referral Rewards:</b> Earn bonuses from your referrals`,

      `💸 <b>Direct BEP20 Payouts:</b> Auto-sent to your wallet`,

      `━━━━━━━━━━━━━━━━━━━━`,

      ``,

      `⚡ <b>Quick Exchange Rate:</b>`,

      `<code>10,000 PTS = 0.10 USDT</code>`,

      `<code>100,000 PTS = 1.00 USDT</code>`,

      ``,

      `🔒 <b>IMPORTANT:</b> You must join BOTH official channels before using the app.`,

      ``,

      `👇 <b>Tap below to launch USDT Hub!</b>`

    ].join("\n");


    await sendMessage(
      chatId,

      welcomeMessage,

      {
        reply_markup: {

          inline_keyboard: [

            [
              {
                text:
                  "🚀 OPEN USDT HUB APP",

                web_app: {
                  url:
                    launchUrl
                }
              }
            ],

            [
              {
                text:
                  "📢 Channel 1",

                url:
                  "https://t.me/usdt_hub_payment_proof"
              },

              {
                text:
                  "💎 Channel 2",

                url:
                  "https://t.me/usdt_g_ram"
              }
            ],

            [
              {
                text:
                  "💬 Community & Support",

                url:
                  `https://t.me/${CONFIG.SUPPORT_USERNAME}`
              }
            ]

          ]
        }
      }
    );
  }


  return res.status(200).json({
    success: true
  });
}


/* =========================================================
   MAIN API HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Content-Type",
    "application/json"
  );


  try {

    const path =
      getPath(req);


    const endpoint =
      req.query?.endpoint ||
      req.body?.endpoint ||
      "";


    /* -----------------------------
       API STATUS
    ----------------------------- */

    if (
      path === "/api/index" ||
      path === "/api" ||
      path === "/"
    ) {

      if (
        !endpoint &&
        req.method === "GET"
      ) {

        return res.status(200).json({

          success: true,

          message:
            "USDT Hub API Online"
        });
      }
    }


    /* -----------------------------
       PAYOUT INFO
    ----------------------------- */

    if (
      path === "/api/payout-info" ||
      endpoint === "payout-info"
    ) {

      const info =
        await getPayoutWalletInfo();


      return res.status(200).json({

        success: true,

        ...info
      });
    }


    /* -----------------------------
       TELEGRAM
    ----------------------------- */

    if (
      path === "/api/telegram" ||
      endpoint === "telegram"
    ) {
      return telegram(req, res);
    }


    /* -----------------------------
       USER
    ----------------------------- */

    if (
      path === "/api/user" ||
      endpoint === "user"
    ) {
      return userHandler(
        req,
        res
      );
    }


    /* -----------------------------
       STREAK
    ----------------------------- */

    if (
      path === "/api/claim-streak" ||
      endpoint === "claim-streak"
    ) {
      return claimStreak(
        req,
        res
      );
    }


    /* -----------------------------
       MEMBERSHIP
    ----------------------------- */

    if (
      path === "/api/verify-membership" ||
      endpoint === "verify-membership"
    ) {
      return verifyMembership(
        req,
        res
      );
    }


    /* -----------------------------
       WELCOME
    ----------------------------- */

    if (
      path === "/api/claim-welcome" ||
      endpoint === "claim-welcome"
    ) {
      return claimWelcome(
        req,
        res
      );
    }


    /* -----------------------------
       ADS
    ----------------------------- */

    if (
      path === "/api/ads" ||
      endpoint === "ads"
    ) {
      return ads(
        req,
        res
      );
    }


    /* -----------------------------
       DEPOSIT
    ----------------------------- */

    if (
      path === "/api/deposit" ||
      endpoint === "deposit"
    ) {
      return deposit(
        req,
        res
      );
    }


    /* -----------------------------
       PROMO
    ----------------------------- */

    if (
      path === "/api/promo" ||
      endpoint === "promo"
    ) {
      return promo(
        req,
        res
      );
    }


    /* -----------------------------
       REFERRAL
    ----------------------------- */

    if (
      path === "/api/referral" ||
      endpoint === "referral"
    ) {
      return referral(
        req,
        res
      );
    }


    /* -----------------------------
       TASKS
    ----------------------------- */

    if (
      path === "/api/tasks" ||
      endpoint === "tasks"
    ) {
      return tasks(
        req,
        res
      );
    }


    /* -----------------------------
       WITHDRAW
    ----------------------------- */

    if (
      path === "/api/withdraw" ||
      endpoint === "withdraw"
    ) {
      return withdraw(
        req,
        res
      );
    }


    return res.status(404).json({

      success: false,

      error:
        `API route not found: ${path}`
    });


  } catch (error) {

    console.error(
      "USDT HUB API ERROR:",
      error
    );


    return res.status(200).json({

      success: false,

      error:
        error?.message ||
        String(error)
    });
  }
    }
