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


/* =========================================================
   HELPERS
========================================================= */

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

function nextUtcMidnightMs() {
  const now = new Date();

  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0
    )
  );

  return next.getTime();
}

function normalizeUsdtAmount(value) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }

  return Math.round(n * 1e8) / 1e8;
}

function getDailyPromoCode() {
  const codes = Array.isArray(CONFIG.PROMO_CODES)
    ? CONFIG.PROMO_CODES
    : [];

  if (!codes.length) {
    return null;
  }

  const dayNumber =
    Math.floor(Date.now() / 86400000);

  return String(
    codes[dayNumber % codes.length]
  ).toUpperCase();
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
    throw new Error(
      "TELEGRAM_INIT_DATA_MISSING"
    );
  }

  const result =
    validateInitData(initData);

  if (!result?.user) {
    throw new Error(
      "INVALID_TELEGRAM_USER"
    );
  }

  return result;
}

function getVipTier(totalPts = 0) {
  const tiers =
    Object.values(CONFIG.VIP_TIERS || {})
      .sort(
        (a, b) =>
          b.minPts - a.minPts
      );

  for (const tier of tiers) {
    if (totalPts >= tier.minPts) {
      return tier;
    }
  }

  return (
    CONFIG.VIP_TIERS?.BRONZE || {
      name: "Bronze",
      multiplier: 1
    }
  );
}


/* =========================================================
   DEFAULT REWARDS
========================================================= */

const MISSION_REWARDS = {
  watchAds:
    Number(
      CONFIG.MISSION_WATCH_ADS_REWARD ?? 100
    ),

  completeTasks:
    Number(
      CONFIG.MISSION_COMPLETE_TASKS_REWARD ?? 100
    ),

  inviteFriend:
    Number(
      CONFIG.MISSION_INVITE_REWARD ?? 150
    ),

  dailyCheckIn:
    Number(
      CONFIG.MISSION_CHECKIN_REWARD ?? 100
    ),

  allCompleted:
    Number(
      CONFIG.MISSION_ALL_REWARD ?? 300
    )
};


const REFERRAL_MILESTONES = [
  {
    referrals: 3,
    reward: Number(
      CONFIG.REFERRAL_MILESTONE_3 ?? 500
    ),
    name: "Starter"
  },

  {
    referrals: 10,
    reward: Number(
      CONFIG.REFERRAL_MILESTONE_10 ?? 1500
    ),
    name: "Builder"
  },

  {
    referrals: 25,
    reward: Number(
      CONFIG.REFERRAL_MILESTONE_25 ?? 5000
    ),
    name: "Legend"
  },

  {
    referrals: 50,
    reward: Number(
      CONFIG.REFERRAL_MILESTONE_50 ?? 15000
    ),
    name: "Elite"
  }
];


/* =========================================================
   USER
========================================================= */

async function userHandler(req, res) {

  let { user, startParam } =
    getUser(req);

  const uid =
    String(user.id);

  if (
    !startParam &&
    req.body?.startParam
  ) {
    startParam =
      String(
        req.body.startParam
      ).trim();
  }

  const userRef =
    db.collection("users").doc(uid);

  const existing =
    await userRef.get();

  if (existing.exists) {

    const userData =
      existing.data();

    const vip =
      getVipTier(
        Number(
          userData.balance || 0
        )
      );

    return res.status(200).json({

      success: true,

      newUser: false,

      user: {
        ...userData,

        vipTier:
          vip.name,

        vipMultiplier:
          vip.multiplier,

        botUsername:
          CONFIG.BOT_USERNAME,

        supportUsername:
          CONFIG.SUPPORT_USERNAME,

        isAdmin:
          uid ===
          String(CONFIG.ADMIN_ID)
      }
    });
  }


  /* -----------------------------
     REFERRAL
  ----------------------------- */

  let inviterId = null;

  if (
    startParam &&
    String(startParam)
      .startsWith("ref_")
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

    telegramId:
      uid,

    firstName:
      user.first_name || "",

    lastName:
      user.last_name || "",

    username:
      user.username || "",

    balance:
      0,

    adsWatched:
      0,

    monetagAds:
      0,

    adsgramAds:
      0,

    hilltopAds:
      0,

    monetagToday:
      0,

    adsgramToday:
      0,

    hilltopToday:
      0,

    adDate:
      null,

    tasksCompleted:
      0,

    referrals:
      0,

    referralPoints:
      0,

    milestone3Claimed:
      false,

    milestone10Claimed:
      false,

    milestone25Claimed:
      false,

    milestone50Claimed:
      false,

    welcomeBonusClaimed:
      false,

    welcomeBonusStatus:
      "none",

    welcomeBonusSkipped:
      false,

    welcomeAddress:
      null,

    channelsVerified:
      false,

    appUnlocked:
      false,

    streakDay:
      0,

    xp:
      0,

    achievements:
      [],

    achievementCount:
      0,

    lifetimeEarned:
      0,

    totalWithdrawn:
      0,

    todayEarned:
      0,

    todayTasks:
      0,

    todayReferrals:
      0,

    gamesPlayed:
      0,

    gamesWon:
      0,

    gamesToday:
      0,

    gameDate:
      null,

    lastGameAt:
      0,

    adCombo:
      0,

    adComboDate:
      null,

    adsWatchedToday:
      0,

    lastStreakDate:
      null,

    missionDate:
      null,

    missionAds:
      0,

    missionTasks:
      0,

    missionInvites:
      0,

    missionCheckin:
      false,

    missionAllCompleted:
      false,

    withdrawals:
      0,

    lastWithdrawalId:
      null,

    lastWithdrawalDate:
      null,

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


  /* -----------------------------
     REFERRAL RECORD
  ----------------------------- */

  if (inviterId) {

    const referralRef =
      db
        .collection("referrals")
        .doc(
          `${inviterId}_${uid}`
        );

    batch.create(
      referralRef,
      {

        inviterId,

        referredUserId:
          uid,

        channelRewarded:
          false,

        adsRewarded:
          false,

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
      user.first_name ||
        "New Explorer"
    );
  }


  await batch.commit();


  return res.status(200).json({

    success: true,

    newUser: true,

    user: {

      ...userData,

      vipTier:
        "Bronze",

      vipMultiplier:
        1,

      botUsername:
        CONFIG.BOT_USERNAME,

      supportUsername:
        CONFIG.SUPPORT_USERNAME,

      isAdmin:
        uid ===
        String(CONFIG.ADMIN_ID)
    }
  });
}


/* =========================================================
   REFERRAL MILESTONES
========================================================= */

async function checkReferralMilestones(
  uid
) {

  const userRef =
    db.collection("users").doc(uid);

  let earned = [];


  await db.runTransaction(
    async tx => {

      const snap =
        await tx.get(userRef);

      if (!snap.exists) {
        return;
      }

      const u =
        snap.data();

      const count =
        Number(
          u.referrals || 0
        );


      for (
        const milestone
        of REFERRAL_MILESTONES
      ) {

        if (
          count <
          milestone.referrals
        ) {
          continue;
        }

        let field;

        if (
          milestone.referrals === 3
        ) {
          field =
            "milestone3Claimed";
        }

        else if (
          milestone.referrals === 10
        ) {
          field =
            "milestone10Claimed";
        }

        else if (
          milestone.referrals === 25
        ) {
          field =
            "milestone25Claimed";
        }
        else if (
          milestone.referrals === 50
        ) {
          field =
            "milestone50Claimed";
        }

        if (
          !field ||
          u[field]
        ) {
          continue;
        }

        tx.update(
          userRef,
          {

            [field]:
              true,

            balance:
              FieldValue.increment(
                milestone.reward
              ),

            referralPoints:
              FieldValue.increment(
                milestone.reward
              ),

            updatedAt:
              FieldValue.serverTimestamp()
          }
        );

        earned.push({

          name:
            milestone.name,

          referrals:
            milestone.referrals,

          reward:
            milestone.reward
        });
      }
    }
  );


  for (
    const milestone
    of earned
  ) {

    notifyReferralBonus(
      uid,

      `Referral milestone: ${milestone.referrals} friends`,

      milestone.reward
    );
  }

  return earned;
}


/* =========================================================
   DAILY MISSIONS
========================================================= */

function missionStatus(user) {

  const d =
    today();

  const reset =
    user.missionDate !== d;

  const ads =
    reset
      ? 0
      : Number(
          user.missionAds || 0
        );

  const tasks =
    reset
      ? 0
      : Number(
          user.missionTasks || 0
        );

  const invites =
    reset
      ? 0
      : Number(
          user.missionInvites || 0
        );

  const checkin =
    reset
      ? false
      : Boolean(
          user.missionCheckin
        );


  return {

    date:
      d,

    resetAt:
      nextUtcMidnightMs(),

    ads: {

      current:
        ads,

      target:
        5,

      completed:
        ads >= 5,

      reward:
        MISSION_REWARDS.watchAds
    },

    tasks: {

      current:
        tasks,

      target:
        3,

      completed:
        tasks >= 3,

      reward:
        MISSION_REWARDS.completeTasks
    },

    invites: {

      current:
        invites,

      target:
        2,

      completed:
        invites >= 2,

      reward:
        MISSION_REWARDS.inviteFriend
    },

    checkin: {

      current:
        checkin ? 1 : 0,

      target:
        1,

      completed:
        checkin,

      reward:
        MISSION_REWARDS.dailyCheckIn
    },

    allCompleted:
      ads >= 5 &&
      tasks >= 3 &&
      invites >= 2 &&
      checkin,

    allReward:
      MISSION_REWARDS.allCompleted
  };
}


/* =========================================================
   MISSIONS ENDPOINT
========================================================= */

async function missions(
  req,
  res
) {

  const { user } =
    getUser(req);

  const uid =
    String(user.id);

  const userRef =
    db.collection("users").doc(uid);

  const snap =
    await userRef.get();

  if (!snap.exists) {
    throw new Error(
      "USER_NOT_FOUND"
    );
  }

  const u =
    snap.data();

  const status =
    missionStatus(u);

  return res.status(200).json({

    success: true,

    missions:
      status
  });
}


/* =========================================================
   DAILY STREAK / CHECK-IN
========================================================= */

async function claimStreak(
  req,
  res
) {

  const { user } =
    getUser(req);

  const uid =
    String(user.id);

  const userRef =
    db.collection("users").doc(uid);

  const dToday =
    today();

  const dYesterday =
    yesterday();

  let streakReward = 0;

  let newStreak = 1;


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

      if (
        u.lastStreakDate ===
        dToday
      ) {

        throw new Error(
          "STREAK_ALREADY_CLAIMED_TODAY"
        );
      }

      if (
        u.lastStreakDate ===
        dYesterday
      ) {

        newStreak =
          ((u.streakDay || 0) % 7) + 1;

      } else {

        newStreak =
          1;
      }

      const streakRewardsList =
        Array.isArray(CONFIG.DAILY_STREAK_REWARDS) && CONFIG.DAILY_STREAK_REWARDS.length > 0
          ? CONFIG.DAILY_STREAK_REWARDS
          : [50, 75, 100, 150, 200, 300, 500];

      streakReward =
        streakRewardsList[
          newStreak - 1
        ] || 50;

      const resetMission =
        u.missionDate !== dToday;

      tx.update(
        userRef,
        {

          balance:
            FieldValue.increment(
              streakReward
            ),

          lifetimeEarned:
            FieldValue.increment(streakReward),

          todayEarned:
            FieldValue.increment(streakReward),

          xp:
            FieldValue.increment(Math.max(10, Math.floor(streakReward / 5))),

          streakDay:
            newStreak,

          lastStreakDate:
            dToday,

          missionDate:
            dToday,

          missionCheckin:
            true,

          ...(resetMission
            ? {
                missionAds: 0,
                missionTasks: 0,
                missionInvites: 0,
                missionAllCompleted: false
              }
            : {}),

          updatedAt:
            FieldValue.serverTimestamp()
        }
      );
    }
  );


  const updated =
    await userRef.get();

  const mission =
    missionStatus(
      updated.data()
    );

  let allBonus = 0;


  if (
    mission.allCompleted &&
    !updated.data()
      .missionAllCompleted
  ) {

    allBonus =
      MISSION_REWARDS.allCompleted;

    await userRef.update({

      balance:
        FieldValue.increment(
          allBonus
        ),

      missionAllCompleted:
        true,

      updatedAt:
        FieldValue.serverTimestamp()
    });
  }


  return res.status(200).json({

    success: true,

    streakDay:
      newStreak,

    reward:
      streakReward,

    missionBonus:
      allBonus
  });
}


/* =========================================================
   MISSION REWARD HELPER
========================================================= */

async function updateMission(
  uid,
  type
) {

  const userRef =
    db.collection("users").doc(uid);

  let allBonus = 0;


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

      const d =
        today();

      const reset =
        u.missionDate !== d;

      let missionAds =
        reset
          ? 0
          : Number(
              u.missionAds || 0
            );

      let missionTasks =
        reset
          ? 0
          : Number(
              u.missionTasks || 0
            );

      let missionInvites =
        reset
          ? 0
          : Number(
              u.missionInvites || 0
            );

      let missionCheckin =
        reset
          ? false
          : Boolean(
              u.missionCheckin
            );

      let missionAllCompleted =
        reset
          ? false
          : Boolean(
              u.missionAllCompleted
            );


      if (type === "ad") {
        missionAds++;
      }

      if (type === "task") {
        missionTasks++;
      }

      if (type === "invite") {
        missionInvites++;
      }

      if (type === "checkin") {
        missionCheckin = true;
      }


      /* IMPORTANT:
         Withdrawal/missions require 2 invites.
      */

      const complete =
        missionAds >= 5 &&
        missionTasks >= 3 &&
        missionInvites >= 2 &&
        missionCheckin;


      const update = {

        missionDate:
          d,

        missionAds,

        missionTasks,

        missionInvites,

        missionCheckin,

        missionAllCompleted,

        updatedAt:
          FieldValue.serverTimestamp()
      };


      if (
        complete &&
        !missionAllCompleted
      ) {

        allBonus =
          MISSION_REWARDS.allCompleted;

        update.balance =
          FieldValue.increment(
            allBonus
          );
        update.lifetimeEarned =
          FieldValue.increment(allBonus);
        update.todayEarned =
          FieldValue.increment(allBonus);
        update.xp =
          FieldValue.increment(Math.max(25, Math.floor(allBonus / 2)));

        update.missionAllCompleted =
          true;
      }


      tx.update(
        userRef,
        update
      );
    }
  );


  return allBonus;
}


/* =========================================================
   MANDATORY CHANNEL VERIFICATION
========================================================= */

async function verifyMembership(
  req,
  res
) {

  const { user } =
    getUser(req);

  const uid =
    String(user.id);


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
      result =>
        result.joined
    );


  if (!joined) {

    return res.status(200).json({

      success: true,

      joined: false,

      channels:
        results,

      requiredChannels:
        CONFIG.CHANNELS
    });
  }


  const userRef =
    db.collection("users").doc(uid);

  const userDoc =
    await userRef.get();

  if (!userDoc.exists) {
    throw new Error(
      "USER_NOT_FOUND"
    );
  }

  const u =
    userDoc.data();


  await userRef.set(
    {

      channelsVerified:
        true,

      appUnlocked:
        true,

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
        .doc(
          `${u.referredBy}_${uid}`
        );

    const refSnap =
      await refDocRef.get();


    if (
      refSnap.exists &&
      !refSnap.data()
        .channelRewarded
    ) {

      await db.runTransaction(
        async tx => {

          const freshRef =
            await tx.get(
              refDocRef
            );

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

              channelRewarded:
                true,

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

    channels:
      results,

    requiredChannels:
      CONFIG.CHANNELS
  });
}


/* =========================================================
   WELCOME BONUS
========================================================= */

async function claimWelcome(
  req,
  res
) {

  const { user } =
    getUser(req);

  const uid =
    String(user.id);

  const action =
    String(
      req.body?.action || "claim"
    ).toLowerCase();


  /* -----------------------------
     OPTIONAL / SKIP
  ----------------------------- */

  if (action === "skip") {

    const userRef =
      db.collection("users").doc(uid);

    await userRef.set(
      {

        welcomeBonusStatus:
          "skipped",

        welcomeBonusSkipped:
          true,

        appUnlocked:
          true,

        updatedAt:
          FieldValue.serverTimestamp()

      },
      {
        merge: true
      }
    );

    return res.status(200).json({

      success: true,

      skipped: true
    });
  }


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

          userId:
            uid,

          address:
            normalized,

          payoutId:
            payoutRef.id,

          createdAt:
            FieldValue.serverTimestamp()
        }
      );


      tx.set(
        payoutRef,
        {

          type:
            "welcome",

          userId:
            uid,

          address:
            normalized,

          amount:
            CONFIG.WELCOME_USDT,

          status:
            "processing",

          createdAt:
            FieldValue.serverTimestamp()
        }
      );


      tx.update(
        userRef,
        {

          welcomeBonusClaimed:
            true,

          welcomeBonusStatus:
            "processing",

          welcomeAddress:
            normalized,

          appUnlocked:
            true,

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

      status:
        "paid",

      txHash:
        payment.txHash,

      paidAt:
        FieldValue.serverTimestamp()
    });


    await userRef.update({

      welcomeBonusStatus:
        "paid",

      updatedAt:
        FieldValue.serverTimestamp()
    });


    notifyWelcomeBonus(
      uid,

      CONFIG.WELCOME_USDT,

      payment.txHash
    );


    broadcastPaymentProof({

      type:
        "welcome",

      userId:
        uid,

      amountUSDT:
        CONFIG.WELCOME_USDT,

      txHash:
        payment.txHash,

      address:
        normalized
    });


    return res.status(200).json({

      success:
        true,

      amount:
        CONFIG.WELCOME_USDT,

      txHash:
        payment.txHash
    });

  } catch (error) {

    await payoutRef.update({

      status:
        "failed",

      error:
        error?.message ||
        String(error),

      updatedAt:
        FieldValue.serverTimestamp()
    });


    await userRef.update({

      welcomeBonusStatus:
        "failed",

      updatedAt:
        FieldValue.serverTimestamp()
    });


    throw error;
  }
      }
/* =========================================================
   ADS
========================================================= */

async function ads(
  req,
  res
) {

  const { user } =
    getUser(req);

  const uid =
    String(user.id);


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

  const d =
    today();

  let result;

  let shouldRewardInviter =
    false;

  let inviterId =
    null;


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


      const u =
        snap.data();


      if (!u.channelsVerified) {
        throw new Error(
          "CHANNELS_REQUIRED"
        );
      }


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


      let hilltopToday =
        u.adDate === d
          ? Number(
              u.hilltopToday || 0
            )
          : 0;


      if (
        provider === "monetag" &&
        monetagToday >=
          monetagLimit
      ) {

        throw new Error(
          "MONETAG_LIMIT"
        );
      }


      if (
        provider === "adsgram" &&
        adsgramToday >=
          adsgramLimit
      ) {

        throw new Error(
          "ADSGRAM_LIMIT"
        );
      }


      if (
        provider === "hilltop" &&
        hilltopToday >=
          HILLTOP_LIMIT
      ) {

        throw new Error(
          "HILLTOP_LIMIT"
        );
      }


      if (
        provider === "monetag"
      ) {

        monetagToday++;

      } else if (
        provider === "adsgram"
      ) {

        adsgramToday++;

      } else {

        hilltopToday++;
      }


      const totalAds =
        Number(
          u.adsWatched || 0
        ) + 1;


      const vip =
        getVipTier(
          Number(
            u.balance || 0
          )
        );


      const baseReward =
        Math.round(
          CONFIG.AD_REWARD *
          vip.multiplier
        );

      const adBonus = calculateAdBonus(u, baseReward);
      const boostedBase = Math.round(baseReward * adBonus.multiplier);
      const finalReward = boostedBase + adBonus.totalBonus;


      const missionReset =
        u.missionDate !== d;


      const currentMissionAds =
        missionReset
          ? 0
          : Number(
              u.missionAds || 0
            );


      const missionAds =
        currentMissionAds + 1;


      tx.update(
        userRef,
        {

          balance:
            FieldValue.increment(
              finalReward
            ),

          lifetimeEarned:
            FieldValue.increment(
              finalReward
            ),

          todayEarned:
            FieldValue.increment(
              finalReward
            ),

          adsWatchedToday:
            u.adDate === d
              ? FieldValue.increment(1)
              : 1,

          adCombo:
            adBonus.combo,

          adComboDate:
            d,

          adsWatched:
            FieldValue.increment(1),

          [`${provider}Ads`]:
            FieldValue.increment(1),

          monetagToday,

          adsgramToday,

          hilltopToday,

          adDate:
            d,

          missionDate:
            d,

          missionAds,

          missionTasks:
            missionReset
              ? 0
              : Number(
                  u.missionTasks || 0
                ),

          missionInvites:
            missionReset
              ? 0
              : Number(
                  u.missionInvites || 0
                ),

          missionCheckin:
            missionReset
              ? false
              : Boolean(
                  u.missionCheckin
                ),

          updatedAt:
            FieldValue.serverTimestamp()
        }
      );


      if (
        u.referredBy &&
        totalAds >= 2
      ) {

        shouldRewardInviter =
          true;

        inviterId =
          u.referredBy;
      }


      result = {

        reward:
          finalReward,

        baseReward,
        firstAdBonus:
          adBonus.firstBonus,
        combo:
          adBonus.combo,
        comboBonus:
          adBonus.comboBonus,
        weekendBonus:
          adBonus.weekendBonus,
        doublePoints:
          adBonus.doubleHour,
        nextComboAt:
          Math.ceil(adBonus.combo / 5) * 5,

        monetagToday,

        adsgramToday,

        hilltopToday,

        totalAds,

        missionAds
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
        .doc(
          `${inviterId}_${uid}`
        );


    const refSnap =
      await refDocRef.get();


    if (
      refSnap.exists &&
      !refSnap.data()
        .adsRewarded
    ) {

      await db.runTransaction(
        async tx => {

          const freshRef =
            await tx.get(
              refDocRef
            );


          if (!freshRef.exists) {
            return;
          }


          if (
            freshRef.data()
              .adsRewarded
          ) {
            return;
          }


          tx.update(
            refDocRef,
            {

              adsRewarded:
                true,

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


  /*
   * Check referral milestones.
   */

  if (inviterId) {

    await checkReferralMilestones(
      inviterId
    );
  }


  /*
   * Mission full-completion bonus.
   */

  const missionUser =
    await userRef.get();

  const mission =
    missionStatus(
      missionUser.data()
    );

  let missionBonus = 0;


  if (
    mission.allCompleted &&
    !missionUser.data()
      .missionAllCompleted
  ) {

    missionBonus =
      MISSION_REWARDS.allCompleted;


    await userRef.update({

      balance:
        FieldValue.increment(
          missionBonus
        ),

      missionAllCompleted:
        true,

      updatedAt:
        FieldValue.serverTimestamp()
    });
  }


  const unlockedAchievements =
    await applyAchievements(uid);

  const latestUser =
    await userRef.get();

  return res.status(200).json({

    success:
      true,

    ...result,

    missionBonus,
    achievements:
      unlockedAchievements,
    user:
      publicUser(latestUser.data())
  });
}


/* =========================================================
   DEPOSIT
========================================================= */

async function deposit(
  req,
  res
) {

  const { user } =
    getUser(req);

  const uid =
    String(user.id);


  const action =
    String(
      req.body?.action || ""
    ).toLowerCase();


  if (
    action === "info"
  ) {

    return res.status(200).json({

      success:
        true,

      depositAddress:
        CONFIG.DEPOSIT_ADDRESS,

      pointsPerUSDT:
        CONFIG.POINTS_PER_USDT
    });
  }


  if (
    action === "submit"
  ) {

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
        .doc(
          txHash.toLowerCase()
        );


    await db.runTransaction(
      async tx => {

        const snap =
          await tx.get(
            depositRef
          );


        if (snap.exists) {

          throw new Error(
            "TX_ALREADY_SUBMITTED"
          );
        }


        tx.create(
          depositRef,
          {

            userId:
              uid,

            txHash:
              txHash.toLowerCase(),

            status:
              "pending",

            createdAt:
              FieldValue.serverTimestamp()
          }
        );
      }
    );


    return res.status(200).json({

      success:
        true,

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

async function promo(
  req,
  res
) {

  const { user } =
    getUser(req);

  const uid =
    String(user.id);


  const code =
    String(
      req.body?.code || ""
    )
      .trim()
      .toUpperCase();


  if (
    !CONFIG.PROMO_CODES?.includes(
      code
    )
  ) {

    throw new Error(
      "INVALID_CODE"
    );
  }


  const claimRef =
    db
      .collection("promoClaims")
      .doc(
        `${uid}_${code}`
      );


  const userRef =
    db.collection("users").doc(uid);


  await db.runTransaction(
    async tx => {

      const claim =
        await tx.get(
          claimRef
        );


      const u =
        await tx.get(
          userRef
        );


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

          userId:
            uid,

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

    success:
      true,

    reward:
      CONFIG.PROMO_REWARD
  });
}


/* =========================================================
   REFERRALS
========================================================= */

async function referral(
  req,
  res
) {

  const { user } =
    getUser(req);

  const uid =
    String(user.id);


  const action =
    String(
      req.body?.action || ""
    ).toLowerCase();


  if (
    action === "list"
  ) {

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

      success:
        true,

      referrals:
        snap.docs.map(
          doc => ({

            id:
              doc.id,

            ...doc.data()
          })
        )
    });
  }


  if (
    action === "leaderboard"
  ) {

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

      success:
        true,

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


  if (
    action === "milestones"
  ) {

    const snap =
      await db
        .collection("users")
        .doc(uid)
        .get();


    if (!snap.exists) {

      throw new Error(
        "USER_NOT_FOUND"
      );
    }


    const u =
      snap.data();


    const count =
      Number(
        u.referrals || 0
      );


    return res.status(200).json({

      success:
        true,

      referrals:
        count,

      milestones:
        REFERRAL_MILESTONES.map(
          milestone => {

            let claimed =
              false;


            if (
              milestone.referrals === 3
            ) {

              claimed =
                Boolean(
                  u.milestone3Claimed
                );
            }


            if (
              milestone.referrals === 10
            ) {

              claimed =
                Boolean(
                  u.milestone10Claimed
                );
            }


            if (
              milestone.referrals === 25
            ) {

              claimed =
                Boolean(
                  u.milestone25Claimed
                );
            }


            return {

              ...milestone,

              claimed,

              unlocked:
                count >=
                milestone.referrals
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

async function tasks(
  req,
  res
) {

  const { user } =
    getUser(req);

  const uid =
    String(user.id);


  const action =
    String(
      req.body?.action || ""
    ).toLowerCase();


  if (
    action === "list"
  ) {

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

            id:
              doc.id,

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

      success:
        true,

      tasks: availableTasks
    });
  }


  /* -----------------------------
     CREATE TASK
  ----------------------------- */

  if (
    action === "create"
  ) {

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
      db
        .collection("tasks")
        .doc();


    const userRef =
      db
        .collection("users")
        .doc(uid);


    await db.runTransaction(
      async tx => {

        const userSnap =
          await tx.get(
            userRef
          );


        if (!userSnap.exists) {

          throw new Error(
            "USER_NOT_FOUND"
          );
        }


        const u =
          userSnap.data();


        const isAdmin =
          uid ===
          String(
            CONFIG.ADMIN_ID
          );


        if (
          !isAdmin &&
          Number(
            u.balance || 0
          ) <
          Number(
            CONFIG.TASK_CREATE_COST
          )
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
                  -Number(
                    CONFIG.TASK_CREATE_COST
                  )
                ),

              updatedAt:
                FieldValue.serverTimestamp()
            }
          );
        }


        tx.create(
          taskRef,
          {

            ownerId:
              uid,

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
                type ||
                "channel"
              ),

            reward:
              CONFIG.TASK_REWARD,

            completions:
              0,

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


    return res.status(200).json({

      success:
        true,

      taskId:
        taskRef.id
    });
  }


  /* -----------------------------
     COMPLETE TASK
  ----------------------------- */

  if (
    action === "complete"
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


    const taskRef =
      db
        .collection("tasks")
        .doc(taskId);


    const completionRef =
      db
        .collection(
          "taskCompletions"
        )
        .doc(
          `${uid}_${taskId}`
        );


    const userRef =
      db
        .collection("users")
        .doc(uid);


    let reward = 0;

    let missionBonus = 0;


    /* -----------------------------
       NORMAL TASK
    ----------------------------- */

    await db.runTransaction(
      async tx => {

        const taskSnap =
          await tx.get(
            taskRef
          );


        const completion =
          await tx.get(
            completionRef
          );


        const userSnap =
          await tx.get(
            userRef
          );


        if (
          !taskSnap.exists ||
          !userSnap.exists
        ) {

          throw new Error(
            "NOT_FOUND"
          );
        }


        if (
          completion.exists
        ) {

          throw new Error(
            "ALREADY_COMPLETED"
          );
        }


        const task =
          taskSnap.data();


        if (
          task.status !==
          "active"
        ) {

          throw new Error(
            "TASK_CLOSED"
          );
        }


        const currentCompletions =
          Number(
            task.completions || 0
          );


        const maxCompletions =
          Number(
            task.maxCompletions ||
            CONFIG.TASK_LIMIT ||
            50
          );


        if (
          currentCompletions >=
          maxCompletions
        ) {

          throw new Error(
            "TASK_LIMIT_REACHED"
          );
        }


        reward =
          Number(
            CONFIG.TASK_REWARD
          );


        const u =
          userSnap.data();


        const d =
          today();


        const resetMission =
          u.missionDate !== d;


        const currentMissionTasks =
          resetMission
            ? 0
            : Number(
                u.missionTasks || 0
              );


        const missionTasks =
          currentMissionTasks + 1;


        /*
         * Completion record makes this task disappear
         * from this user's list.
         */

        tx.create(
          completionRef,
          {

            userId:
              uid,

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

            lifetimeEarned:
              FieldValue.increment(reward),

            todayEarned:
              FieldValue.increment(reward),

            xp:
              FieldValue.increment(Math.max(15, Math.floor(reward / 5))),

            todayTasks:
              u.missionDate === d
                ? FieldValue.increment(1)
                : 1,

            tasksCompleted:
              FieldValue.increment(
                1
              ),

            missionDate:
              d,

            missionAds:
              resetMission
                ? 0
                : Number(
                    u.missionAds || 0
                  ),

            missionTasks,

            missionInvites:
              resetMission
                ? 0
                : Number(
                    u.missionInvites || 0
                  ),

            missionCheckin:
              resetMission
                ? false
                : Boolean(
                    u.missionCheckin
                  ),

            updatedAt:
              FieldValue.serverTimestamp()
          }
        );


        const newCompletions =
          currentCompletions + 1;


        /*
         * Keep the task for other users.
         * This user's completion record removes it
         * from their task list.
         */

        tx.update(
          taskRef,
          {

            completions:
              newCompletions,

            status:
              newCompletions >=
              maxCompletions
                ? "completed"
                : "active",

            updatedAt:
              FieldValue.serverTimestamp()
          }
        );
      }
    );


    missionBonus =
      await updateMission(
        uid,
        "task"
      );


    const unlockedAchievements =
      await applyAchievements(uid);
    const latestUser = await userRef.get();

    return res.status(200).json({

      success:
        true,

      reward,

      missionBonus,
      achievements:
        unlockedAchievements,
      user:
        publicUser(latestUser.data())
    });
  }


  throw new Error(
    "UNKNOWN_ACTION"
  );
}


/* =========================================================
   WITHDRAW
========================================================= */

async function withdraw(
  req,
  res
) {

  const { user } =
    getUser(req);

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
    ethers.getAddress(address);


  const pointsPerUSDT =
    Number(
      CONFIG.POINTS_PER_USDT
    );


  const minPoints =
    Number(
      CONFIG.WITHDRAW_MIN_POINTS
    );


  if (
    !Number.isFinite(
      pointsPerUSDT
    ) ||
    pointsPerUSDT <= 0
  ) {

    throw new Error(
      "INVALID_POINTS_RATE"
    );
  }


  /*
   * Frontend may send:
   *
   * amountUSDT / amount
   *
   * OR
   *
   * points
   */

  const requestedPointsRaw =
    req.body?.points;


  const requestedUsdtRaw =
    req.body?.amountUSDT ??
    req.body?.amount;


  let points;

  let amount;


  if (
    requestedPointsRaw !==
      undefined &&
    requestedPointsRaw !==
      null &&
    requestedPointsRaw !== ""
  ) {

    points =
      Math.floor(
        Number(
          requestedPointsRaw
        )
      );


    if (
      !Number.isFinite(points) ||
      points <= 0
    ) {

      throw new Error(
        "INVALID_AMOUNT"
      );
    }


    amount =
      points /
      pointsPerUSDT;

  } else {

    amount =
      normalizeUsdtAmount(
        requestedUsdtRaw
      );


    if (amount === null) {

      throw new Error(
        "AMOUNT_REQUIRED"
      );
    }


    points =
      Math.ceil(
        amount *
        pointsPerUSDT
      );
  }


  if (
    points <
    minPoints
  ) {

    throw new Error(
      "MINIMUM_NOT_REACHED"
    );
  }


  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {

    throw new Error(
      "INVALID_AMOUNT"
    );
  }


  /*
   * Charge whole points only.
   * USDT amount is derived from points.
   */

  amount =
    Number(
      (
        points /
        pointsPerUSDT
      ).toFixed(8)
    );


  const userRef =
    db.collection("users").doc(uid);


  const withdrawalRef =
    db
      .collection("withdrawals")
      .doc();


  const todayDate =
    today();


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


      /*
       * Both mandatory channels.
       */

      if (
        !u.channelsVerified
      ) {

        throw new Error(
          "CHANNELS_REQUIRED"
        );
      }


      /*
       * Two valid referrals required.
       */

      const referralCount =
        Number(
          u.referrals || 0
        );


      if (
        referralCount < 2
      ) {

        throw new Error(
          "TWO_REFERRALS_REQUIRED"
        );
      }


      /*
       * Only one withdrawal per UTC day.
       */

      if (
        u.lastWithdrawalDate ===
        todayDate
      ) {

        throw new Error(
          "WITHDRAWAL_LIMIT_TODAY"
        );
      }


      /*
       * Enough points.
       */

      if (
        Number(
          u.balance || 0
        ) < points
      ) {

        throw new Error(
          "INSUFFICIENT_BALANCE"
        );
      }


      /*
       * Reserve the balance before payout.
       */

      tx.update(
        userRef,
        {

          balance:
            FieldValue.increment(
              -points
            ),

          withdrawals:
            FieldValue.increment(
              1
            ),

          lastWithdrawalId:
            withdrawalRef.id,

          lastWithdrawalDate:
            todayDate,

          updatedAt:
            FieldValue.serverTimestamp()
        }
      );


      tx.create(
        withdrawalRef,
        {

          userId:
            uid,

          address:
            destination,

          points,

          amountUSDT:
            amount,

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
        amount
      );


    await withdrawalRef.update({

      status:
        "paid",

      txHash:
        payment.txHash,

      paidAt:
        FieldValue.serverTimestamp()
    });

    await userRef.update({
      totalWithdrawn:
        FieldValue.increment(amount),
      updatedAt:
        FieldValue.serverTimestamp()
    });


    await notifyWithdrawalSuccess(
      uid,

      amount.toFixed(8),

      payment.txHash
    );


    await broadcastPaymentProof({

      type:
        "withdraw",

      userId:
        uid,

      amountUSDT:
        amount,

      txHash:
        payment.txHash,

      address:
        destination
    });


    return res.status(200).json({

      success:
        true,

      amount,

      points,

      txHash:
        payment.txHash,

      nextWithdrawalDate:
        todayDate
    });

  } catch (error) {

    /*
     * Payout failed:
     * restore the user's points.
     */

    await db.runTransaction(
      async tx => {

        tx.update(
          userRef,
          {

            balance:
              FieldValue.increment(
                points
              ),

            withdrawals:
              FieldValue.increment(
                -1
              ),

            lastWithdrawalId:
              null,

            lastWithdrawalDate:
              null,

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
   DAILY NOTIFICATION CRON
========================================================= */

/*
 * Configure Vercel Cron to call:
 *
 * /api/cron/daily
 *
 * The endpoint requires:
 *
 * Authorization: Bearer YOUR_CRON_SECRET
 *
 * The cron should run frequently enough to catch:
 *
 * 1. Morning daily-bonus message
 * 2. Promo code one hour later
 */

async function dailyCron(
  req,
  res
) {

  const secret =
    String(
      process.env.CRON_SECRET || ""
    );


  const auth =
    String(
      req.headers?.authorization || ""
    );


  const supplied =
    auth.startsWith("Bearer ")
      ? auth.slice(7)
      : String(
          req.query?.secret || ""
        );


  if (
    !secret ||
    supplied !== secret
  ) {

    return res.status(401).json({

      success:
        false,

      error:
        "UNAUTHORIZED"
    });
  }


  const now =
    Date.now();


  const currentDate =
    today();


  const promoCode =
    getDailyPromoCode();


  const usersSnap =
    await db
      .collection("users")
      .limit(5000)
      .get();


  let morningSent = 0;

  let promoSent = 0;


  for (
    const doc
    of usersSnap.docs
  ) {

    const u =
      doc.data();

    const uid =
      doc.id;


    /*
     * Morning bonus message
     */

    if (
      u.dailyBonusMessageDate !==
      currentDate
    ) {

      const sent =
        await sendMessage(

          uid,

          `🎁 <b>YOUR DAILY BONUS IS WAITING!</b> 🎁\n\n` +

          `🔥 Don’t miss your daily reward!\n\n` +

          `💰 Claim your bonus today and keep earning with USDT HUB.\n\n` +

          `⏰ Open the bot now and claim it before you forget!\n\n` +

          `🚀 Claim. Earn. Repeat.`,

          {

            reply_markup: {

              inline_keyboard: [

                [

                  {

                    text:
                      "🎁 CLAIM DAILY BONUS",

                    web_app: {

                      url:
                        CONFIG.WEBAPP_URL
                    }
                  }

                ]

              ]
            }
          }
        );


      if (sent?.ok) {

        await doc.ref.update({

          dailyBonusMessageDate:
            currentDate,

          dailyPromoScheduledAt:
            now +
            60 *
            60 *
            1000,

          dailyPromoCode:
            promoCode,

          updatedAt:
            FieldValue.serverTimestamp()
        });


        morningSent++;
      }
    }


    /*
     * Promo message one hour later.
     */

    const scheduled =
      Number(
        u.dailyPromoScheduledAt ||
        0
      );


    if (
      scheduled &&
      scheduled <= now &&
      u.dailyPromoSentDate !==
        currentDate &&
      promoCode
    ) {

      const code =
        String(
          u.dailyPromoCode ||
          promoCode
        ).toUpperCase();


      const sent =
        await sendMessage(

          uid,

          `🎟️ <b>YOUR DAILY PROMO CODE IS HERE!</b>\n\n` +

          `🎁 Code: <code>${code}</code>\n` +

          `💰 Reward: <b>+${Number(
            CONFIG.PROMO_REWARD || 0
          )} PTS</b>\n\n` +

          `Open USDT HUB and claim it now!`,

          {

            reply_markup: {

              inline_keyboard: [

                [

                  {

                    text:
                      "🎟️ CLAIM PROMO",

                    web_app: {

                      url:
                        `${CONFIG.WEBAPP_URL}?promo=${encodeURIComponent(
                          code
                        )}`
                    }
                  }

                ]

              ]
            }
          }
        );


      if (sent?.ok) {

        await doc.ref.update({

          dailyPromoSentDate:
            currentDate,

          dailyPromoScheduledAt:
            null,

          updatedAt:
            FieldValue.serverTimestamp()
        });


        promoSent++;
      }
    }
  }


  return res.status(200).json({

    success:
      true,

    date:
      currentDate,

    morningSent,

    promoSent
  });
}



/* =========================================================
   PREMIUM GAMIFICATION / ARCADE
   Server-authoritative rewards only.
========================================================= */

const GAME_CONFIG = {
  // Each individual game can be played exactly twice per UTC day.
  chancesPerGame: Number(CONFIG.GAME_CHANCES_PER_GAME ?? 2),
  dailyLimit: Number(CONFIG.GAME_DAILY_LIMIT ?? 12),
  cooldownMs: Number(CONFIG.GAME_COOLDOWN_MS ?? 15 * 1000),
  minBet: Number(CONFIG.GAME_MIN_BET ?? 10),
  maxBet: Number(CONFIG.GAME_MAX_BET ?? 500),
  rewards: {
    coinflip: 50,
    dice: 75,
    number: 100,
    scratch: 75,
    wheel: 100,
    mystery: 150
  }
};

const GAME_NAMES = new Set([
  "coinflip",
  "dice",
  "number",
  "scratch",
  "wheel",
  "mystery"
]);

function safeInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getLevelInfo(xp = 0) {
  const value = Math.max(0, safeInt(xp));
  const level = Math.max(1, Math.floor(Math.sqrt(value / 100)) + 1);
  const currentFloor = Math.pow(level - 1, 2) * 100;
  const nextFloor = Math.pow(level, 2) * 100;
  const progress = nextFloor > currentFloor
    ? Math.round(((value - currentFloor) / (nextFloor - currentFloor)) * 100)
    : 100;
  return {
    level,
    xp: value,
    currentXP: Math.max(0, value - currentFloor),
    neededXP: Math.max(1, nextFloor - currentFloor),
    progress: clamp(progress, 0, 100),
    nextLevelXP: nextFloor
  };
}

function getRankInfo(points = 0) {
  const p = Math.max(0, safeInt(points));
  if (p >= 100000) return { name: "Diamond", icon: "💎", min: 100000 };
  if (p >= 50000) return { name: "Platinum", icon: "🏆", min: 50000 };
  if (p >= 25000) return { name: "Gold", icon: "🥇", min: 25000 };
  if (p >= 10000) return { name: "Silver", icon: "🥈", min: 10000 };
  return { name: "Bronze", icon: "🥉", min: 0 };
}

function addXpToUserUpdate(update, amount) {
  const xp = Math.max(0, safeInt(amount));
  if (xp > 0) update.xp = FieldValue.increment(xp);
}

function getAchievementDefinitions() {
  return [
    { id: "first_ad", title: "First Watch", icon: "📺", field: "adsWatched", target: 1 },
    { id: "ads_100", title: "Ad Hunter", icon: "⚡", field: "adsWatched", target: 100 },
    { id: "ads_500", title: "Ad Machine", icon: "🚀", field: "adsWatched", target: 500 },
    { id: "tasks_25", title: "Task Master", icon: "🎯", field: "tasksCompleted", target: 25 },
    { id: "tasks_100", title: "Mission Master", icon: "🏅", field: "tasksCompleted", target: 100 },
    { id: "ref_10", title: "Team Builder", icon: "👥", field: "referrals", target: 10 },
    { id: "ref_50", title: "Team Leader", icon: "🌟", field: "referrals", target: 50 },
    { id: "points_100k", title: "100K Club", icon: "💎", field: "balance", target: 100000 },
    { id: "points_500k", title: "Half Million", icon: "👑", field: "balance", target: 500000 },
    { id: "streak_7", title: "7-Day Flame", icon: "🔥", field: "streakDay", target: 7 },
    { id: "streak_30", title: "30-Day Legend", icon: "☄️", field: "streakDay", target: 30 },
    { id: "games_25", title: "Arcade Regular", icon: "🎮", field: "gamesPlayed", target: 25 },
    { id: "games_100", title: "Arcade Pro", icon: "🕹️", field: "gamesPlayed", target: 100 },
    { id: "first_withdrawal", title: "First Withdrawal", icon: "🏆", field: "withdrawals", target: 1 }
  ];
}

function evaluateAchievements(user) {
  const unlocked = new Set(Array.isArray(user.achievements) ? user.achievements : []);
  const newly = [];
  for (const a of getAchievementDefinitions()) {
    if (unlocked.has(a.id)) continue;
    if (Number(user[a.field] || 0) >= a.target) newly.push(a);
  }
  return newly;
}

async function applyAchievements(uid) {
  const ref = db.collection("users").doc(uid);
  let newly = [];
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("USER_NOT_FOUND");
    const u = snap.data();
    newly = evaluateAchievements(u);
    if (!newly.length) return;

    const ids = Array.isArray(u.achievements) ? [...u.achievements] : [];
    for (const a of newly) ids.push(a.id);

    const xpReward = newly.length * 100;
    tx.update(ref, {
      achievements: ids,
      achievementCount: ids.length,
      balance: FieldValue.increment(xpReward),
      lifetimeEarned: FieldValue.increment(xpReward),
      todayEarned: FieldValue.increment(xpReward),
      xp: FieldValue.increment(xpReward),
      updatedAt: FieldValue.serverTimestamp()
    });
  });
  return newly.map(a => ({ ...a, reward: 100 }));
}

function publicUser(userData = {}) {
  const balance = Number(userData.balance || 0);
  const vip = getVipTier(balance);
  const level = getLevelInfo(userData.xp || 0);
  const rank = getRankInfo(balance);

  // Only expose user-profile fields that the web app needs. Never return
  // server-only payout/error metadata if future fields are added to users.
  const safeFields = [
    "telegramId", "firstName", "lastName", "username", "balance",
    "adsWatched", "monetagAds", "adsgramAds", "hilltopAds",
    "monetagToday", "adsgramToday", "hilltopToday", "adDate",
    "adsWatchedToday", "adCombo", "adComboDate",
    "tasksCompleted", "todayTasks", "referrals", "todayReferrals",
    "referralPoints", "referralCode", "referredBy",
    "milestone3Claimed", "milestone10Claimed", "milestone25Claimed", "milestone50Claimed",
    "welcomeBonusClaimed", "welcomeBonusStatus", "welcomeBonusSkipped", "welcomeAddress",
    "channelsVerified", "appUnlocked", "streakDay", "lastStreakDate",
    "missionDate", "missionAds", "missionTasks", "missionInvites", "missionCheckin", "missionAllCompleted",
    "withdrawals", "lastWithdrawalId", "lastWithdrawalDate",
    "xp", "achievements", "achievementCount", "lifetimeEarned", "totalWithdrawn", "todayEarned",
    "gamesPlayed", "gamesWon", "gamesToday", "gameDate", "lastGameAt",
    "createdAt", "updatedAt"
  ];

  const safe = {};
  for (const key of safeFields) {
    if (Object.prototype.hasOwnProperty.call(userData, key)) safe[key] = userData[key];
  }

  return {
    ...safe,
    vipTier: vip.name,
    vipMultiplier: vip.multiplier,
    level: level.level,
    xp: level.xp,
    xpProgress: level.progress,
    rank: rank.name,
    rankIcon: rank.icon,
    botUsername: CONFIG.BOT_USERNAME,
    supportUsername: CONFIG.SUPPORT_USERNAME
  };
}

async function dashboard(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("USER_NOT_FOUND");
  const u = snap.data();
  const d = today();
  const adsToday = u.adDate === d
    ? Number(u.monetagToday || 0) + Number(u.adsgramToday || 0) + Number(u.hilltopToday || 0)
    : 0;
  const mission = missionStatus(u);
  const level = getLevelInfo(u.xp || 0);
  const rank = getRankInfo(u.balance || 0);
  const vip = getVipTier(Number(u.balance || 0));
  return res.status(200).json({
    success: true,
    today: {
      date: d,
      earnings: Number(u.todayEarned || 0),
      ads: adsToday,
      tasks: Number(u.todayTasks || 0),
      referrals: Number(u.todayReferrals || 0)
    },
    totals: {
      earned: Number(u.lifetimeEarned || 0),
      withdrawn: Number(u.totalWithdrawn || 0),
      ads: Number(u.adsWatched || 0),
      tasks: Number(u.tasksCompleted || 0),
      referrals: Number(u.referrals || 0)
    },
    streak: {
      day: Number(u.streakDay || 0),
      lastDate: u.lastStreakDate || null
    },
    level,
    rank,
    vip: { name: vip.name, multiplier: vip.multiplier },
    mission,
    achievements: Array.isArray(u.achievements) ? u.achievements : []
  });
}

async function leaderboard(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const type = String(req.body?.type || req.query?.type || "earnings").toLowerCase();
  const allowed = new Set(["earnings", "ads", "tasks", "referrals"]);
  const field = allowed.has(type) ? ({
    earnings: "balance",
    ads: "adsWatched",
    tasks: "tasksCompleted",
    referrals: "referrals"
  })[type] : "balance";

  const snap = await db.collection("users").orderBy(field, "desc").limit(50).get();
  const rows = snap.docs.map((doc, index) => {
    const u = doc.data();
    return {
      rank: index + 1,
      userId: doc.id,
      firstName: u.firstName || "Explorer",
      username: u.username || "",
      value: Number(u[field] || 0),
      isMe: doc.id === uid,
      badge: index === 0 ? "👑" : index === 1 ? "🥈" : index === 2 ? "🥉" : ""
    };
  });
  return res.status(200).json({ success: true, type, leaderboard: rows });
}

async function achievements(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) throw new Error("USER_NOT_FOUND");
  const u = snap.data();
  const unlocked = new Set(Array.isArray(u.achievements) ? u.achievements : []);
  return res.status(200).json({
    success: true,
    achievements: getAchievementDefinitions().map(a => ({
      ...a,
      unlocked: unlocked.has(a.id),
      progress: clamp(Number(u[a.field] || 0), 0, a.target),
      target: a.target
    }))
  });
}

async function playGame(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const game = String(req.body?.game || "").toLowerCase();
  if (!GAME_NAMES.has(game)) throw new Error("INVALID_GAME");

  // Games are free-to-play. The server is the only authority for
  // chances, results, XP and balance rewards.
  const ref = db.collection("users").doc(uid);
  let result = null;
  let levelUp = false;

  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("USER_NOT_FOUND");
    const u = snap.data();
    const now = Date.now();
    const day = today();
    const last = Number(u.lastGameAt || 0);

    const rawCounts = u.gamesByDay && u.gamesByDay.date === day
      ? (u.gamesByDay.counts || {})
      : {};
    const gameCounts = {};
    for (const name of GAME_NAMES) gameCounts[name] = Math.max(0, safeInt(rawCounts[name], 0));

    const currentGameCount = gameCounts[game] || 0;
    if (currentGameCount >= GAME_CONFIG.chancesPerGame) {
      throw new Error("GAME_CHANCES_USED");
    }

    const gamesToday = u.gameDate === day ? Number(u.gamesToday || 0) : 0;
    if (gamesToday >= GAME_CONFIG.dailyLimit) throw new Error("GAME_DAILY_LIMIT");

    if (last && now - last < GAME_CONFIG.cooldownMs) {
      throw new Error(`GAME_COOLDOWN_${Math.ceil((GAME_CONFIG.cooldownMs - (now - last)) / 1000)}`);
    }

    let won = false;
    let display = "Round complete";
    let reveal = {};
    let rarity = "STANDARD";

    // The final result is created here on the server. The client only animates it.
    if (game === "coinflip") {
      const side = Math.random() < 0.5 ? "heads" : "tails";
      const choice = String(req.body?.choice || "").toLowerCase();
      won = choice === side;
      reveal = { result: side, choice };
      display = won ? `You called ${side.toUpperCase()} correctly.` : `It landed on ${side.toUpperCase()}.`;
    } else if (game === "dice") {
      const roll = randomInt(1, 6);
      const choice = String(req.body?.choice || "").toLowerCase();
      won = choice === "high" ? roll >= 4 : choice === "low" ? roll <= 3 : false;
      reveal = { roll, choice, zone: roll >= 4 ? "HIGH" : "LOW" };
      display = `The dice landed on ${roll} (${reveal.zone}).`;
    } else if (game === "number") {
      const chosen = clamp(safeInt(req.body?.choice ?? req.body?.number, 1), 1, 5);
      const lucky = randomInt(1, 5);
      won = chosen === lucky;
      reveal = { lucky, choice: chosen };
      display = won ? `Bullseye! ${lucky} was your number.` : `The lucky number was ${lucky}.`;
    } else if (game === "scratch") {
      const symbols = ["🍀", "💎", "⭐", "🎁", "💰"];
      const chosen = clamp(safeInt(req.body?.choice, 1), 1, 3);
      const base = symbols[randomInt(0, symbols.length - 1)];
      const win = Math.random() < 0.65;
      const revealed = win
        ? [base, base, symbols[randomInt(0, symbols.length - 1)]]
        : [base, symbols.filter(x => x !== base)[randomInt(0, symbols.length - 2)], symbols.filter(x => x !== base)[randomInt(0, symbols.length - 2)]];
      won = win;
      reveal = { card: chosen, symbols: revealed };
      display = won ? "Three matching symbols — prize unlocked." : "No matching set this time.";
    } else if (game === "wheel") {
      const segments = [
        { label: "50 PTS", reward: 50, win: true },
        { label: "75 PTS", reward: 75, win: true },
        { label: "100 PTS", reward: 100, win: true },
        { label: "MISS", reward: 0, win: false },
        { label: "150 PTS", reward: 150, win: true },
        { label: "JACKPOT 300", reward: 300, win: true }
      ];
      const segment = segments[randomInt(0, segments.length - 1)];
      won = segment.win;
      reveal = { segment: segment.label, reward: segment.reward };
      display = won ? `The wheel stopped on ${segment.label}.` : "The wheel stopped on MISS.";
    } else if (game === "mystery") {
      const boxes = [
        { rarity: "COMMON", reward: 50, icon: "🎁" },
        { rarity: "RARE", reward: 100, icon: "💎" },
        { rarity: "EPIC", reward: 200, icon: "👑" },
        { rarity: "ULTRA", reward: 500, icon: "🌟" }
      ];
      const roll = Math.random();
      const prize = roll < 0.65 ? boxes[0] : roll < 0.9 ? boxes[1] : roll < 0.99 ? boxes[2] : boxes[3];
      const box = clamp(safeInt(req.body?.choice, 1), 1, 3);
      won = true;
      rarity = prize.rarity;
      reveal = { box, reward: prize.reward, icon: prize.icon };
      display = `${prize.rarity} box opened: ${prize.reward} PTS.`;
    }

    const configuredReward = Math.max(50, safeInt(GAME_CONFIG.rewards[game], 50));
    const revealReward = Number(reveal.reward || 0);
    const reward = won ? Math.max(configuredReward, revealReward) : 0;
    const xpGain = won ? 25 : 5;
    const nextXp = Number(u.xp || 0) + xpGain;
    const oldLevel = getLevelInfo(u.xp || 0).level;
    const newLevel = getLevelInfo(nextXp).level;
    levelUp = newLevel > oldLevel;

    gameCounts[game] = currentGameCount + 1;
    const totalGames = gamesToday + 1;

    tx.update(ref, {
      balance: FieldValue.increment(reward),
      lifetimeEarned: FieldValue.increment(reward),
      todayEarned: FieldValue.increment(reward),
      xp: FieldValue.increment(xpGain),
      gamesPlayed: FieldValue.increment(1),
      gamesWon: FieldValue.increment(won ? 1 : 0),
      gameDate: day,
      gamesToday: totalGames,
      gamesByDay: { date: day, counts: gameCounts },
      lastGameAt: now,
      updatedAt: FieldValue.serverTimestamp()
    });

    result = {
      game,
      won,
      reward,
      net: reward,
      display,
      outcome: display,
      rarity,
      reveal,
      gamesToday: totalGames,
      gamesRemaining: Math.max(0, GAME_CONFIG.dailyLimit - totalGames),
      gameChancesUsed: gameCounts[game],
      gameChancesRemaining: Math.max(0, GAME_CONFIG.chancesPerGame - gameCounts[game]),
      xpGain,
      level: newLevel,
      levelUp
    };
  });

  const newAchievements = await applyAchievements(uid);
  const updated = await ref.get();
  return res.status(200).json({
    success: true,
    ...result,
    user: publicUser(updated.data()),
    achievements: newAchievements
  });
}
async function gameStatus(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) throw new Error("USER_NOT_FOUND");
  const u = snap.data();
  const d = today();
  const played = u.gameDate === d ? Number(u.gamesToday || 0) : 0;
  const last = Number(u.lastGameAt || 0);
  const raw = u.gamesByDay && u.gamesByDay.date === d ? (u.gamesByDay.counts || {}) : {};
  const games = {};
  for (const name of GAME_NAMES) games[name] = Math.max(0, safeInt(raw[name], 0));
  const remaining = {};
  for (const name of GAME_NAMES) remaining[name] = Math.max(0, GAME_CONFIG.chancesPerGame - games[name]);
  return res.status(200).json({
    success: true,
    dailyLimit: GAME_CONFIG.dailyLimit,
    gamesToday: played,
    gamesRemaining: Math.max(0, GAME_CONFIG.dailyLimit - played),
    cooldownSeconds: last ? Math.max(0, Math.ceil((GAME_CONFIG.cooldownMs - (Date.now() - last)) / 1000)) : 0,
    chancesPerGame: GAME_CONFIG.chancesPerGame,
    games,
    remaining,
    minBet: GAME_CONFIG.minBet,
    maxBet: GAME_CONFIG.maxBet
  });
}

async function events(req, res) {
  const { user } = getUser(req);
  const uid = String(user.id);
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) throw new Error("USER_NOT_FOUND");
  const u = snap.data();
  const now = new Date();
  const weekend = [0, 6].includes(now.getUTCDay());
  const doubleHours = Array.isArray(CONFIG.DOUBLE_POINTS_HOURS) ? CONFIG.DOUBLE_POINTS_HOURS : [];
  return res.status(200).json({
    success: true,
    events: [
      {
        id: "weekend",
        title: "Weekend Boost",
        icon: "⚡",
        active: weekend,
        description: weekend ? "Extra rewards are active today." : "Returns every weekend.",
        reward: Number(CONFIG.WEEKEND_BONUS || 0)
      },
      {
        id: "double_hour",
        title: "Double Points Hour",
        icon: "🔥",
        active: doubleHours.includes(now.getUTCHours()),
        description: doubleHours.length ? "Check back during a boosted hour." : "Special boosted hours will appear here.",
        reward: 2
      },
      {
        id: "streak",
        title: "7-Day Streak",
        icon: "🔥",
        active: true,
        description: `${Number(u.streakDay || 0)} day streak — keep going!`,
        reward: 0
      }
    ]
  });
}

/* =========================================================
   SUPPORT
========================================================= */

async function support(
  req,
  res
) {

  const { user } =
    getUser(req);


  return res.status(200).json({

    success:
      true,

    username:
      CONFIG.SUPPORT_USERNAME,

    url:
      `https://t.me/${String(
        CONFIG.SUPPORT_USERNAME
      ).replace(
        /^@/,
        ""
      )}`,

    message:
      "Need help? Contact USDT Hub Support."
  });
}


/* =========================================================
   TELEGRAM BOT
========================================================= */

async function telegram(
  req,
  res
) {

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

        ? `${baseUrl}?startapp=${encodeURIComponent(
            startParam
          )}`

        : baseUrl;


    const welcomeMessage = [

      `💎 <b>WELCOME TO USDT HUB, ${String(
        firstName
      ).toUpperCase()}!</b> 💎`,

      `<i>Your Telegram micro-earning hub.</i>`,

      ``,

      `━━━━━━━━━━━━━━━━━━━━`,

      `🎁 <b>Optional 0.01 USDT Welcome Gift</b>`,

      `📺 <b>Daily Ad Mining</b>`,

      `👥 <b>Referral Rewards & Milestones</b>`,

      `🎯 <b>Daily Missions</b>`,

      `🔥 <b>Daily Streaks</b>`,

      `💸 <b>BEP20 Withdrawals</b>`,

      `━━━━━━━━━━━━━━━━━━━━`,

      ``,

      `⚡ <b>Exchange Rate</b>`,

      `<code>10,000 PTS = 0.10 USDT</code>`,

      `<code>100,000 PTS = 1.00 USDT</code>`,

      ``,

      `🔒 <b>IMPORTANT:</b> Join BOTH official channels before using the app.`,

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
                  `https://t.me/${String(
                    CONFIG.SUPPORT_USERNAME
                  ).replace(
                    /^@/,
                    ""
                  )}`
              }

            ]

          ]
        }
      }
    );
  }


  return res.status(200).json({

    success:
      true
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

          success:
            true,

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

        success:
          true,

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

      return telegram(
        req,
        res
      );
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
       MISSIONS
    ----------------------------- */

    if (
      path === "/api/missions" ||
      endpoint === "missions"
    ) {

      return missions(
        req,
        res
      );
    }


    /* -----------------------------
       MEMBERSHIP
    ----------------------------- */

    if (
      path === "/api/verify-membership" ||
      endpoint ===
        "verify-membership"
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
      endpoint ===
        "claim-welcome"
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


    /* -----------------------------
       DAILY CRON
    ----------------------------- */

    if (
      path === "/api/cron/daily" ||
      endpoint === "cron-daily"
    ) {

      return dailyCron(
        req,
        res
      );
    }


    /* -----------------------------
       DASHBOARD
    ----------------------------- */

    if (
      path === "/api/dashboard" ||
      endpoint === "dashboard"
    ) {
      return dashboard(req, res);
    }


    /* -----------------------------
       LEADERBOARD
    ----------------------------- */

    if (
      path === "/api/leaderboard" ||
      endpoint === "leaderboard"
    ) {
      return leaderboard(req, res);
    }


    /* -----------------------------
       ACHIEVEMENTS
    ----------------------------- */

    if (
      path === "/api/achievements" ||
      endpoint === "achievements"
    ) {
      return achievements(req, res);
    }


    /* -----------------------------
       GAMES
    ----------------------------- */

    if (
      path === "/api/game-play" ||
      endpoint === "game-play"
    ) {
      return playGame(req, res);
    }

    if (
      path === "/api/game-status" ||
      endpoint === "game-status"
    ) {
      return gameStatus(req, res);
    }


    /* -----------------------------
       LIVE EVENTS
    ----------------------------- */

    if (
      path === "/api/events" ||
      endpoint === "events"
    ) {
      return events(req, res);
    }


    /* -----------------------------
       SUPPORT
    ----------------------------- */

    if (
      path === "/api/support" ||
      endpoint === "support"
    ) {

      return support(
        req,
        res
      );
    }


    return res.status(404).json({

      success:
        false,

      error:
        `API route not found: ${path}`
    });


  } catch (error) {

    console.error(
      "USDT HUB API ERROR:",
      error
    );


    return res.status(200).json({

      success:
        false,

      error:
        error?.message ||
        String(error)
    });
  }
          }
