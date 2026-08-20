import crypto from "node:crypto";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { ethers } from "ethers";

// ============================================================
// CONFIG
// ============================================================

const CONFIG = {
  CHANNELS: [
    process.env.CHANNEL_1 || "@birr_gram",
    process.env.CHANNEL_2 || "@usdt_g_ram"
  ],

  WELCOME_USDT: Number(process.env.WELCOME_USDT || "0.01"),

  AD_REWARD: Number(process.env.AD_REWARD || "0.02"),

  MONETAG_LIMIT: Number(
    process.env.MONETAG_LIMIT || "25"
  ),

  ADSGRAM_LIMIT: Number(
    process.env.ADSGRAM_LIMIT || "25"
  ),

  REFERRAL_CHANNEL: Number(
    process.env.REFERRAL_CHANNEL || "0.10"
  ),

  REFERRAL_ADS: Number(
    process.env.REFERRAL_ADS || "0.10"
  ),

  PROMO_REWARD: Number(
    process.env.PROMO_REWARD || "0.10"
  ),

  TASK_CREATE_COST: Number(
    process.env.TASK_CREATE_COST || "1"
  ),

  TASK_REWARD: Number(
    process.env.TASK_REWARD || "0.02"
  ),

  TASK_LIMIT: Number(
    process.env.TASK_LIMIT || "50"
  ),

  WITHDRAW_MIN_POINTS: Number(
    process.env.WITHDRAW_MIN_POINTS || "10"
  ),

  POINTS_PER_USDT: Number(
    process.env.POINTS_PER_USDT || "100"
  )
};

// ============================================================
// FIREBASE
// ============================================================

function required(name) {
  const value = process.env[name];

  if (!value || !String(value).trim()) {
    throw new Error(
      `Missing environment variable: ${name}`
    );
  }

  return String(value).trim();
}

const firebaseApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId:
            required("FIREBASE_PROJECT_ID"),

          clientEmail:
            required("FIREBASE_CLIENT_EMAIL"),

          privateKey:
            required("FIREBASE_PRIVATE_KEY")
              .replace(/\\n/g, "\n")
        })
      });

const db = getFirestore(firebaseApp);

// ============================================================
// BASIC HELPERS
// ============================================================

function today() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

function getPath(req) {
  return String(req.url || "")
    .split("?")[0]
    .replace(/\/+$/, "");
}

function action(req) {
  return String(
    req.body?.action ||
    req.query?.action ||
    ""
  ).toLowerCase();
}

function memberOK(member) {
  return [
    "member",
    "administrator",
    "creator"
  ].includes(member?.status);
}

function errorResponse(res, error) {
  console.error(
    "USDT HUB ERROR:",
    error
  );

  const message =
    error?.message ||
    "REQUEST_FAILED";

  const statusMap = {
    INVALID_INIT_DATA: 401,
    INIT_DATA_EXPIRED: 401,
    TELEGRAM_INIT_DATA_REQUIRED: 401,
    TELEGRAM_USER_REQUIRED: 401,

    USER_NOT_FOUND: 404,

    CHANNELS_REQUIRED: 403,

    INVALID_ADDRESS: 400,

    MINIMUM_NOT_REACHED: 400,

    ALREADY_COMPLETED: 409,

    ADDRESS_ALREADY_USED: 409,

    WELCOME_ALREADY_CLAIMED: 409
  };

  return res.status(
    statusMap[message] || 400
  ).json({
    success: false,
    error: message
  });
}

// ============================================================
// TELEGRAM AUTH
// ============================================================

function getInitData(req) {
  const value =
    req.headers?.["x-telegram-init-data"] ||
    req.body?.initData ||
    req.query?.initData ||
    "";

  if (!value) {
    throw new Error(
      "TELEGRAM_INIT_DATA_REQUIRED"
    );
  }

  return String(value);
}

function validateInitData(initData) {
  const token =
    process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN_MISSING"
    );
  }

  const params =
    new URLSearchParams(initData);

  const hash =
    params.get("hash");

  if (!hash) {
    throw new Error(
      "INVALID_INIT_DATA"
    );
  }

  const authDate =
    Number(params.get("auth_date"));

  if (
    !authDate ||
    Math.abs(
      Date.now() / 1000 -
      authDate
    ) > 86400
  ) {
    throw new Error(
      "INIT_DATA_EXPIRED"
    );
  }

  const pairs = [];

  for (
    const [key, value]
    of params.entries()
  ) {
    if (key !== "hash") {
      pairs.push(
        `${key}=${value}`
      );
    }
  }

  pairs.sort();

  const dataCheckString =
    pairs.join("\n");

  const secret =
    crypto
      .createHmac(
        "sha256",
        "WebAppData"
      )
      .update(token)
      .digest();

  const expected =
    crypto
      .createHmac(
        "sha256",
        secret
      )
      .update(dataCheckString)
      .digest("hex");

  const a =
    Buffer.from(expected, "utf8");

  const b =
    Buffer.from(hash, "utf8");

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {
    throw new Error(
      "INVALID_INIT_DATA"
    );
  }

  let user;

  try {
    user = JSON.parse(
      params.get("user") || "{}"
    );
  } catch {
    throw new Error(
      "INVALID_USER_DATA"
    );
  }

  if (!user?.id) {
    throw new Error(
      "TELEGRAM_USER_REQUIRED"
    );
  }

  return {
    user,

    startParam:
      params.get("start_param") ||
      params.get("startapp") ||
      ""
  };
}

// ============================================================
// TELEGRAM API
// ============================================================

async function telegram(method, payload) {
  const token =
    process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN_MISSING"
    );
  }

  const response =
    await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json"
        },

        body:
          JSON.stringify(payload)
      }
    );

  const data =
    await response.json();

  if (!data.ok) {
    throw new Error(
      data.description ||
      "TELEGRAM_API_ERROR"
    );
  }

  return data.result;
}

async function getChatMember(
  chatId,
  userId
) {
  return telegram(
    "getChatMember",
    {
      chat_id: chatId,
      user_id: userId
    }
  );
}

async function sendMessage(
  chatId,
  text,
  extra = {}
) {
  return telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra
    }
  );
}

// ============================================================
// USER
// ============================================================

async function userEndpoint(
  req,
  res
) {
  const {
    user,
    startParam
  } =
    validateInitData(
      getInitData(req)
    );

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
    startParam.startsWith("ref_")
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

    adDate: null,

    tasksCompleted: 0,

    referrals: 0,

    referralPoints: 0,

    welcomeBonusClaimed: false,

    welcomeBonusStatus:
      "none",

    welcomeAddress: null,

    channelsVerified: false,

    appUnlocked: false,

    aviatorGames: 0,

    aviatorWins: 0,

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
    batch.create(
      db
        .collection("referrals")
        .doc(
          `${inviterId}_${uid}`
        ),
      {
        inviterId,

        referredUserId:
          uid,

        channelReward:
          CONFIG.REFERRAL_CHANNEL,

        adsReward:
          CONFIG.REFERRAL_ADS,

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
  }

  await batch.commit();

  try {
    await sendMessage(
      uid,
      "🎉 <b>Welcome to USDT Hub!</b>\n\nYour account has been created."
    );
  } catch {}

  return res.status(201).json({
    success: true,

    newUser: true,

    user: userData
  });
}

// ============================================================
// CHANNEL VERIFICATION
// ============================================================

async function verifyMembership(
  req,
  res
) {
  const { user } =
    validateInitData(
      getInitData(req)
    );

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
    .set(
      {
        channelsVerified:
          true,

        updatedAt:
          FieldValue.serverTimestamp()
      },
      {
        merge: true
      }
    );

  return res.json({
    success: true,
    joined: true
  });
}

// ============================================================
// WELCOME BONUS
// ============================================================

async function claimWelcome(
  req,
  res
) {
  const { user } =
    validateInitData(
      getInitData(req)
    );

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
    ethers.getAddress(address);

  const userRef =
    db.collection("users")
      .doc(uid);

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

      tx.create(
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
      status: "paid",

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
      welcomeBonusStatus:
        "failed",

      updatedAt:
        FieldValue.serverTimestamp()
    });

    throw error;
  }
}

// ============================================================
// ADS
// ============================================================

async function rewardAd(
  req,
  res
) {
  const { user } =
    validateInitData(
      getInitData(req)
    );

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

// ============================================================
// PROMO
// ============================================================

const PROMO_CODES = [
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
  const { user } =
    validateInitData(
      getInitData(req)
    );

  const uid =
    String(user.id);

  const code =
    String(
      req.body?.code || ""
    )
      .trim()
      .toUpperCase();

  if (
    !PROMO_CODES.includes(code)
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
    db.collection("users")
      .doc(uid);

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

  return res.json({
    success: true,

    reward:
      CONFIG.PROMO_REWARD
  });
}

// ============================================================
// REFERRALS
// ============================================================

async function referral(
  req,
  res
) {
  const { user } =
    validateInitData(
      getInitData(req)
    );

  const uid =
    String(user.id);

  const a =
    String(
      req.body?.action || ""
    );

  if (a === "list") {
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

  if (a === "check") {
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

        const userRef =
          db.collection("users")
            .doc(uid);

        const userSnap =
          await tx.get(userRef);

        if (
          !refSnap.exists ||
          !userSnap.exists
        ) {
          throw new Error(
            "USER_NOT_FOUND"
          );
        }

        const ref =
          refSnap.data();

        const u =
          userSnap.data();

        const inviterRef =
          db.collection("users")
            .doc(
              String(
                ref.inviterId
              )
            );

        const inviterSnap =
          await tx.get(
            inviterRef
          );

        if (!inviterSnap.exists) {
          throw new Error(
            "INVITER_NOT_FOUND"
          );
        }

        let reward = 0;

        const updates = {};

        if (
          u.channelsVerified &&
          !ref.channelRewarded
        ) {
          updates.channelRewarded =
            true;

          reward +=
            CONFIG.REFERRAL_CHANNEL;
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
            CONFIG.REFERRAL_ADS;
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

// ============================================================
// TASKS
// ============================================================

async function tasks(
  req,
  res
) {
  const { user } =
    validateInitData(
      getInitData(req)
    );

  const uid =
    String(user.id);

  const a =
    String(
      req.body?.action || ""
    );

  if (a === "list") {
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
          d => ({
            id: d.id,
            ...d.data()
          })
        )
    });
  }

  if (a === "create") {
    const {
      title,
      link,
      chatId,
      type
    } = req.body || {};

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

  if (a === "complete") {
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
      db
        .collection("taskCompletions")
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

    const member =
      await getChatMember(
        taskSnap.data().chatId,
        uid
      );

    if (!memberOK(member)) {
      throw new Error(
        "TELEGRAM_MEMBERSHIP_REQUIRED"
      );
    }

    await db.runTransaction(
      async tx => {
        const freshTask =
          await tx.get(taskRef);

        const completion =
          await tx.get(
            completionRef
          );

        const userSnap =
          await tx.get(userRef);

        if (
          !freshTask.exists ||
          !userSnap.exists
        ) {
          throw new Error(
            "USER_NOT_FOUND"
          );
        }

        if (completion.exists) {
          throw new Error(
            "ALREADY_COMPLETED"
          );
        }

        const task =
          freshTask.data();

        const count =
          Number(
            task.completions || 0
          );

        if (
          task.status !==
            "active" ||
          count >=
            CONFIG.TASK_LIMIT
        ) {
          throw new Error(
            "TASK_FULL"
          );
        }

        tx.create(
          completionRef,
          {
            userId: uid,

            taskId,

            reward:
              CONFIG.TASK_REWARD,

            createdAt:
              FieldValue.serverTimestamp()
          }
        );

        const next =
          count + 1;

        tx.update(
          taskRef,
          {
            completions:
              next,

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
                CONFIG.TASK_REWARD
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

      reward:
        CONFIG.TASK_REWARD
    });
  }

  throw new Error(
    "UNKNOWN_ACTION"
  );
}

// ============================================================
// WITHDRAW
// ============================================================

async function sendUSDT(
  address,
  amount
) {
  const rpc =
    process.env.BSC_RPC_URL;

  const privateKey =
    process.env.PAYOUT_PRIVATE_KEY;

  if (!rpc || !privateKey) {
    throw new Error(
      "PAYOUT_CONFIGURATION_MISSING"
    );
  }

  const provider =
    new ethers.JsonRpcProvider(
      rpc
    );

  const wallet =
    new ethers.Wallet(
      privateKey,
      provider
    );

  const contractAddress =
    process.env.USDT_BEP20_CONTRACT ||
    "0x55d398326f99059fF775485246999027B3197955";

  const abi = [
    "function transfer(address to,uint256 value) returns (bool)",
    "function decimals() view returns (uint8)"
  ];

  const token =
    new ethers.Contract(
      contractAddress,
      abi,
      wallet
    );

  const decimals =
    Number(
      await token.decimals()
    );

  const value =
    ethers.parseUnits(
      String(amount),
      decimals
    );

  const tx =
    await token.transfer(
      ethers.getAddress(address),
      value
    );

  const receipt =
    await tx.wait();

  return {
    txHash:
      receipt.hash
  };
}

async function withdraw(
  req,
  res
) {
  const { user } =
    validateInitData(
      getInitData(req)
    );

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

  const points =
    CONFIG.WITHDRAW_MIN_POINTS;

  const amount =
    Number(
      (
        points /
        CONFIG.POINTS_PER_USDT
      ).toFixed(8)
    );

  const userRef =
    db.collection("users")
      .doc(uid);

  const withdrawalRef =
    db.collection("withdrawals")
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

    return res.json({
      success: true,

      amount,

      points,

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
                points
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
              error.message,

            updatedAt:
              FieldValue.serverTimestamp()
          }
        );
      }
    );

    throw error;
  }
}

// ============================================================
// LIVE AVIATOR DEMO
// ============================================================

async function games(
  req,
  res
) {
  const { user } =
    validateInitData(
      getInitData(req)
    );

  const uid =
    String(user.id);

  const gameAction =
    String(
      req.body?.action || ""
    );

  const roundRef =
    db
      .collection("aviator")
      .doc("live");

  if (
    gameAction === "state"
  ) {
    let snap =
      await roundRef.get();

    if (!snap.exists) {
      const round = {
        status:
          "running",

        startedAt:
          Date.now(),

        crashAt:
          Number(
            (
              1.5 +
              Math.random() * 5
            ).toFixed(2)
          )
      };

      await roundRef.set(
        round
      );

      snap =
        await roundRef.get();
    }

    const round =
      snap.data();

    const elapsed =
      Math.max(
        0,
        Date.now() -
          Number(
            round.startedAt
          )
      );

    let multiplier =
      Number(
        Math.exp(
          elapsed / 18000
        ).toFixed(2)
      );

    if (
      multiplier >=
      Number(round.crashAt)
    ) {
      multiplier =
        Number(
          round.crashAt
        );

      await roundRef.set(
        {
          ...round,

          status:
            "crashed",

          multiplier
        }
      );

      return res.json({
        success: true,

        round: {
          status:
            "crashed",

          multiplier
        }
      });
    }

    return res.json({
      success: true,

      round: {
        status:
          "running",

        multiplier
      }
    });
  }

  if (
    gameAction === "new"
  ) {
    const round = {
      status:
        "running",

      startedAt:
        Date.now(),

      crashAt:
        Number(
          (
            1.5 +
            Math.random() * 5
          ).toFixed(2)
        )
    };

    await roundRef.set(
      round
    );

    return res.json({
      success: true,

      round
    });
  }

  if (
    gameAction ===
    "cashout"
  ) {
    const snap =
      await roundRef.get();

    if (!snap.exists) {
      throw new Error(
        "NO_ROUND"
      );
    }

    const round =
      snap.data();

    const elapsed =
      Math.max(
        0,
        Date.now() -
          Number(
            round.startedAt
          )
      );

    const multiplier =
      Number(
        Math.min(
          Number(
            round.crashAt
          ),
          Math.exp(
            elapsed / 18000
          )
        ).toFixed(2)
      );

    if (
      multiplier >=
      Number(round.crashAt)
    ) {
      throw new Error(
        "ROUND_CRASHED"
      );
    }

    return res.json({
      success: true,

      multiplier,

      demoOnly:
        true
    });
  }

  throw new Error(
    "UNKNOWN_GAME_ACTION"
  );
}

// ============================================================
// TELEGRAM WEBHOOK
// ============================================================

async function telegramWebhook(
  req,
  res
) {
  const message =
    req.body?.message;

  if (
    message?.text?.startsWith(
      "/start"
    )
  ) {
    const url =
      process.env.WEBAPP_URL ||
      "";

    await sendMessage(
      message.chat.id,

      "🔥 <b>Welcome to USDT Hub!</b>\n\nEarn rewards from ads, tasks and referrals.",

      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  "🚀 OPEN USDT HUB",

                web_app: {
                  url
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

// ============================================================
// MAIN HANDLER
// ============================================================

export default async function handler(
  req,
  res
) {
  try {
    const path =
      getPath(req);

    if (
      path ===
      "/api/telegram"
    ) {
      return telegramWebhook(
        req,
        res
      );
    }

    if (
      req.method !==
      "POST"
    ) {
      return res.status(405).json({
        success: false,
        error:
          "METHOD_NOT_ALLOWED"
      });
    }

    if (
      path ===
        "/api/user" ||
      action(req) === "user"
    ) {
      return userEndpoint(
        req,
        res
      );
    }

    if (
      path ===
        "/api/verify-membership" ||
      action(req) ===
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
      action(req) ===
        "claim-welcome"
    ) {
      return claimWelcome(
        req,
        res
      );
    }

    if (
      path ===
      "/api/ads"
    ) {
      return rewardAd(
        req,
        res
      );
    }

    if (
      path ===
      "/api/promo"
    ) {
      return promo(
        req,
        res
      );
    }

    if (
      path ===
      "/api/referral"
    ) {
      return referral(
        req,
        res
      );
    }

    if (
      path ===
      "/api/tasks"
    ) {
      return tasks(
        req,
        res
      );
    }

    if (
      path ===
      "/api/withdraw"
    ) {
      return withdraw(
        req,
        res
      );
    }

    if (
      path ===
      "/api/games"
    ) {
      return games(
        req,
        res
      );
    }

    return res.status(404).json({
      success: false,
      error:
        "API_ROUTE_NOT_FOUND"
    });

  } catch (error) {
    return errorResponse(
      res,
      error
    );
  }
    }.
