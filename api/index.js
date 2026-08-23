"use strict";

const crypto = require("crypto");
const { ethers } = require("ethers");
const admin = require("firebase-admin");

// ============================================================
// ENVIRONMENT VARIABLES & CONFIGURATION
// ============================================================
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const BOT_USERNAME = process.env.BOT_USERNAME || "Ussdt_hub_bot";
const ADMIN_TELEGRAM_ID = String(process.env.ADMIN_TELEGRAM_ID || "514560");
const PROOF_CHANNEL_ID = process.env.PROOF_CHANNEL_ID || "@birr_gram";

// Mandatory Channels for Verification
const REQUIRED_CHANNELS = [
  { id: "@birr_gram", name: "Birr Gram" },
  { id: "@usdt_g_ram", name: "USDT Gram" }
];

// Web3 Automated Payout Wallet (BNB Smart Chain / BEP20)
const BSC_RPC_URL = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org/";
const PAYOUT_PRIVATE_KEY = process.env.PAYOUT_PRIVATE_KEY || "";
const USDT_BEP20_CONTRACT = process.env.USDT_BEP20_CONTRACT || "0x55d398326f99059fF775485246999027B3197955";
const DEPOSIT_RECEIVING_ADDRESS = process.env.DEPOSIT_RECEIVING_ADDRESS || "";

// Standard ERC20 / BEP20 ABI for USDT Transfers
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

// 7-Day Login Streak Rewards (PTS)
const STREAK_REWARDS = [50, 75, 100, 150, 200, 300, 500];

// ============================================================
// FIREBASE ADMIN INITIALIZATION (STRICT PERSISTENCE)
// ============================================================
if (!admin.apps.length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      let sa = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (typeof sa === "string") {
        sa = JSON.parse(sa);
      }
      admin.initializeApp({
        credential: admin.credential.cert(sa)
      });
    } catch (e) {
      console.error("FIREBASE_SERVICE_ACCOUNT parsing error:", e);
      admin.initializeApp({
        credential: admin.credential.applicationDefault()
      });
    }
  } else if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      })
    });
  } else {
    admin.initializeApp();
  }
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// ============================================================
// TELEGRAM AUTHENTICATION & VALIDATION
// ============================================================
function validateTelegramInitData(initData) {
  if (!initData) return null;

  try {
    const params = new URLSearchParams(initData);
    const userRaw = params.get("user");
    if (!userRaw) return null;

    const parsedUser = JSON.parse(userRaw);

    // If BOT_TOKEN is present, run strict HMAC SHA256 validation
    if (BOT_TOKEN) {
      const hash = params.get("hash");
      if (hash) {
        params.delete("hash");
        const dataCheckString = Array.from(params.entries())
          .map(([k, v]) => `${k}=${v}`)
          .sort()
          .join("\n");

        const secretKey = crypto
          .createHmac("sha256", "WebAppData")
          .update(BOT_TOKEN)
          .digest();

        const calculatedHash = crypto
          .createHmac("sha256", secretKey)
          .update(dataCheckString)
          .digest("hex");

        if (calculatedHash === hash) {
          parsedUser._verified = true;
        }
      }
    }

    return parsedUser;
  } catch (err) {
    console.error("validateTelegramInitData error:", err);
    return null;
  }
}

// Check membership in Telegram channels via Bot API
async function checkChannelMembership(channelId, userId) {
  if (!BOT_TOKEN) return true;
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(channelId)}&user_id=${userId}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok || !data.result) return false;
    const status = data.result.status;
    return ["creator", "administrator", "member", "restricted"].includes(status);
  } catch (err) {
    console.error("Channel check error:", err);
    return false;
  }
}

// Broadcast payout notification to Telegram Proof Channel
async function broadcastPaymentProof({ type, userId, amountUsdt, txHash, toAddress }) {
  if (!BOT_TOKEN || !PROOF_CHANNEL_ID) return;
  try {
    const maskedAddr = `${toAddress.slice(0, 6)}...${toAddress.slice(-4)}`;
    const text =
      `🚀 <b>New Automated Payout Sent!</b>\n\n` +
      `💰 <b>Amount:</b> ${amountUsdt} USDT (BEP20)\n` +
      `👤 <b>User:</b> <code>${userId}</code>\n` +
      `📥 <b>Wallet:</b> <code>${maskedAddr}</code>\n` +
      `🔗 <b>Tx Hash:</b> <a href="https://bscscan.com/tx/${txHash}">${txHash.slice(0, 14)}...</a>\n\n` +
      `⚡ <i>USDT Hub Micro-Earning System</i>`;

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: PROOF_CHANNEL_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });
  } catch (err) {
    console.error("Proof broadcast failed:", err);
  }
}

// Send automated BEP20 USDT transaction on BNB Smart Chain
async function sendBscUsdt(recipientAddress, amountUsdt) {
  if (!PAYOUT_PRIVATE_KEY) {
    throw new Error("Server payout private key is not configured.");
  }

  const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
  const wallet = new ethers.Wallet(PAYOUT_PRIVATE_KEY, provider);
  const usdtContract = new ethers.Contract(USDT_BEP20_CONTRACT, ERC20_ABI, wallet);

  const decimals = await usdtContract.decimals();
  const amountParsed = ethers.parseUnits(amountUsdt.toString(), decimals);

  const tx = await usdtContract.transfer(recipientAddress, amountParsed);
  const receipt = await tx.wait(1);

  return receipt.hash;
}

// ============================================================
// SERVERLESS ROUTE HANDLER
// ============================================================
module.exports = async function handler(req, res) {
  // CORS configuration
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader("Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Telegram-Init-Data");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const initData = req.headers["x-telegram-init-data"] || req.body?.initData || "";
  let tgUser = validateTelegramInitData(initData);

  // Fallback to body user payload if initData is wrapped
  if (!tgUser && req.body?.user && req.body.user.id) {
    tgUser = req.body.user;
  }

  // URL & Endpoint Router
  const urlPath = req.url || "";
  const endpoint =
    req.query.endpoint ||
    req.body.endpoint ||
    urlPath.split("?")[0].replace(/^\/api\/?/, "");

  if (!tgUser) {
    if (endpoint === "public-info" || req.method === "GET") {
      return res.json({ success: true, name: "USDT Hub", status: "Operational" });
    }
    return res.status(401).json({ success: false, error: "UNAUTHORIZED_TELEGRAM_SESSION" });
  }

  const userId = String(tgUser.id);
  const userRef = db.collection("users").doc(userId);

  try {
    // ----------------------------------------------------
    // 1. USER PROFILE / GET OR CREATE
    // ----------------------------------------------------
    if (endpoint === "user") {
      const startParam = req.body.startParam || "";
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        let referrerId = null;
        if (startParam && startParam.startsWith("ref_")) {
          const possibleRef = startParam.replace("ref_", "").trim();
          if (possibleRef && possibleRef !== userId) {
            referrerId = possibleRef;
          }
        }

        const newUser = {
          telegramId: userId,
          firstName: tgUser.first_name || "",
          lastName: tgUser.last_name || "",
          username: tgUser.username || "",
          balance: 0,
          adsWatched: 0,
          monetagToday: 0,
          hilltopToday: 0,
          lastAdDate: "",
          tasksCompleted: 0,
          referrals: 0,
          referralPoints: 0,
          referrerId: referrerId,
          channelsVerified: false,
          welcomeBonusClaimed: false,
          vipTier: "Bronze",
          streakDay: 0,
          lastStreakDate: "",
          aviatorWins: 0,
          botUsername: BOT_USERNAME,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        await userRef.set(newUser);

        if (referrerId) {
          await db.collection("referrals").doc(`${referrerId}_${userId}`).set({
            referrerId,
            referredUserId: userId,
            channelRewarded: false,
            adsRewarded: false,
            createdAt: new Date().toISOString()
          });
        }

        return res.json({ success: true, user: newUser });
      }

      const user = userDoc.data();
      user.botUsername = BOT_USERNAME;
      return res.json({ success: true, user });
    }

    // ----------------------------------------------------
    // 2. VERIFY CHANNELS MEMBERSHIP
    // ----------------------------------------------------
    if (endpoint === "verify-membership") {
      let allJoined = true;
      for (const ch of REQUIRED_CHANNELS) {
        const isMember = await checkChannelMembership(ch.id, userId);
        if (!isMember) {
          allJoined = false;
          break;
        }
      }

      if (!allJoined) {
        return res.json({ success: true, joined: false });
      }

      const userDoc = await userRef.get();
      const userData = userDoc.data() || {};

      await userRef.update({
        channelsVerified: true,
        updatedAt: new Date().toISOString()
      });

      // Reward referrer (+500 PTS for channel verification)
      if (userData.referrerId) {
        const refLinkDocRef = db.collection("referrals").doc(`${userData.referrerId}_${userId}`);
        const refLinkDoc = await refLinkDocRef.get();

        if (refLinkDoc.exists && !refLinkDoc.data().channelRewarded) {
          const referrerDocRef = db.collection("users").doc(userData.referrerId);
          await db.runTransaction(async (t) => {
            const rDoc = await t.get(referrerDocRef);
            if (rDoc.exists) {
              const rData = rDoc.data();
              t.update(referrerDocRef, {
                balance: (rData.balance || 0) + 500,
                referralPoints: (rData.referralPoints || 0) + 500,
                referrals: (rData.referrals || 0) + 1
              });
              t.update(refLinkDocRef, { channelRewarded: true });
            }
          });
        }
      }

      return res.json({ success: true, joined: true });
    }

    // ----------------------------------------------------
    // 3. CLAIM WELCOME BONUS (0.01 USDT ON-CHAIN)
    // ----------------------------------------------------
    if (endpoint === "claim-welcome") {
      const address = String(req.body.address || "").trim();
      if (!ethers.isAddress(address)) {
        return res.status(400).json({ success: false, error: "Invalid BEP20 address." });
      }

      const userDoc = await userRef.get();
      const userData = userDoc.data() || {};

      if (userData.welcomeBonusClaimed) {
        return res.status(400).json({ success: false, error: "Welcome bonus already claimed." });
      }

      const txHash = await sendBscUsdt(address, "0.01");

      await userRef.update({
        welcomeBonusClaimed: true,
        bep20Address: address,
        welcomeTxHash: txHash,
        updatedAt: new Date().toISOString()
      });

      broadcastPaymentProof({
        type: "welcome_bonus",
        userId,
        amountUsdt: "0.01",
        txHash,
        toAddress: address
      });

      return res.json({ success: true, txHash });
    }

    // ----------------------------------------------------
    // 4. CLAIM 7-DAY LOGIN STREAK
    // ----------------------------------------------------
    if (endpoint === "claim-streak") {
      const userDoc = await userRef.get();
      const userData = userDoc.data() || {};

      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const lastStreakDate = userData.lastStreakDate || "";

      if (lastStreakDate === todayStr) {
        return res.status(400).json({ success: false, error: "STREAK_ALREADY_CLAIMED_TODAY" });
      }

      let streakDay = Number(userData.streakDay || 0);

      if (lastStreakDate) {
        const lastDate = new Date(lastStreakDate);
        const diffDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          streakDay = streakDay >= 7 ? 1 : streakDay + 1;
        } else {
          streakDay = 1;
        }
      } else {
        streakDay = 1;
      }

      const reward = STREAK_REWARDS[streakDay - 1] || 50;
      const newBalance = Number(userData.balance || 0) + reward;

      await userRef.update({
        balance: newBalance,
        streakDay,
        lastStreakDate: todayStr,
        updatedAt: new Date().toISOString()
      });

      return res.json({ success: true, streakDay, reward, balance: newBalance });
    }

    // ----------------------------------------------------
    // 5. ADS MINING (MONETAG [25] + HILLTOPADS [15])
    // ----------------------------------------------------
    if (endpoint === "ads") {
      const provider = req.body.provider || "monetag";
      const userDoc = await userRef.get();
      const userData = userDoc.data() || {};

      const todayStr = new Date().toISOString().slice(0, 10);
      const lastAdDate = userData.lastAdDate || "";

      let monetagToday = lastAdDate === todayStr ? Number(userData.monetagToday || 0) : 0;
      let hilltopToday = lastAdDate === todayStr ? Number(userData.hilltopToday || 0) : 0;

      if (provider === "monetag") {
        if (monetagToday >= 25) {
          return res.status(400).json({ success: false, error: "Daily Monetag limit (25) reached. Try HilltopAds!" });
        }
        monetagToday += 1;
      } else if (provider === "hilltop") {
        if (hilltopToday >= 15) {
          return res.status(400).json({ success: false, error: "Daily HilltopAds limit (15) reached." });
        }
        hilltopToday += 1;
      } else {
        return res.status(400).json({ success: false, error: "Unsupported ad provider." });
      }

      const reward = 75; // 75 PTS per ad
      const totalAds = Number(userData.adsWatched || 0) + 1;
      const newBalance = Number(userData.balance || 0) + reward;

      await userRef.update({
        balance: newBalance,
        adsWatched: totalAds,
        monetagToday,
        hilltopToday,
        lastAdDate: todayStr,
        updatedAt: new Date().toISOString()
      });

      // Second referral reward (+500 PTS when referral completes 2 ads)
      if (userData.referrerId && totalAds >= 2) {
        const refLinkDocRef = db.collection("referrals").doc(`${userData.referrerId}_${userId}`);
        const refLinkDoc = await refLinkDocRef.get();

        if (refLinkDoc.exists && !refLinkDoc.data().adsRewarded) {
          const referrerDocRef = db.collection("users").doc(userData.referrerId);
          await db.runTransaction(async (t) => {
            const rDoc = await t.get(referrerDocRef);
            if (rDoc.exists) {
              const rData = rDoc.data();
              t.update(referrerDocRef, {
                balance: (rData.balance || 0) + 500,
                referralPoints: (rData.referralPoints || 0) + 500
              });
              t.update(refLinkDocRef, { adsRewarded: true });
            }
          });
        }
      }

      return res.json({
        success: true,
        reward,
        totalAds,
        monetagToday,
        hilltopToday,
        balance: newBalance
      });
    }

    // ----------------------------------------------------
    // 6. SYNCHRONIZED AVIATOR & GAMES ENGINE
    // ----------------------------------------------------
    if (endpoint === "games") {
      const action = req.body.action;
      const now = Date.now();
      const epochSeconds = Math.floor(now / 1000);
      const roundIndex = Math.floor(epochSeconds / 16);
      const msInRound = now % 16000;

      // Deterministic multiplier matching client formula
      const seed = (roundIndex * 9301 + 49297) % 233280;
      const rand = seed / 233280;
      let crashMultiplier;

      if (rand < 0.045) crashMultiplier = 1.00;
      else if (rand < 0.55) crashMultiplier = 1.01 + rand * 0.45;
      else if (rand < 0.80) crashMultiplier = 1.25 + (rand - 0.55) * 2.8;
      else if (rand < 0.93) crashMultiplier = 1.95 + (rand - 0.80) * 8.0;
      else if (rand < 0.985) crashMultiplier = 3.00 + (rand - 0.93) * 35.0;
      else crashMultiplier = 8.00 + (rand - 0.985) * 120.0;

      crashMultiplier = Math.round(crashMultiplier * 100) / 100;
      const flyTimeMs = Math.min(8500, Math.max(1600, Math.log(crashMultiplier + 1) * 3600));
      const bettingDuration = 5000;

      // BET ACTION
      if (action === "aviator_bet") {
        if (msInRound >= bettingDuration) {
          return res.status(400).json({ success: false, error: "Betting closed for this flight. Wait for the next round!" });
        }

        const bet = Math.floor(Number(req.body.bet || 0));
        if (bet <= 0) {
          return res.status(400).json({ success: false, error: "Invalid bet amount." });
        }

        const userDoc = await userRef.get();
        const userData = userDoc.data() || {};
        if (Number(userData.balance || 0) < bet) {
          return res.status(400).json({ success: false, error: "Insufficient balance." });
        }

        const betDocRef = db.collection("aviator_bets").doc(`${userId}_${roundIndex}`);
        const existingBet = await betDocRef.get();
        if (existingBet.exists) {
          return res.status(400).json({ success: false, error: "You already placed a bet for this flight." });
        }

        await userRef.update({
          balance: Number(userData.balance || 0) - bet,
          updatedAt: new Date().toISOString()
        });

        await betDocRef.set({
          userId,
          roundIndex,
          bet,
          cashedOut: false,
          createdAt: new Date().toISOString()
        });

        return res.json({ success: true, bet, roundIndex });
      }

      // CASHOUT ACTION
      if (action === "aviator_cashout") {
        const betDocRef = db.collection("aviator_bets").doc(`${userId}_${roundIndex}`);
        const betDoc = await betDocRef.get();

        if (!betDoc.exists) {
          return res.status(400).json({ success: false, error: "No active bet found for this flight." });
        }

        const betData = betDoc.data();
        if (betData.cashedOut) {
          return res.status(400).json({ success: false, error: "Already cashed out." });
        }

        if (msInRound < bettingDuration) {
          return res.status(400).json({ success: false, error: "Plane has not taken off yet." });
        }

        if (msInRound >= bettingDuration + flyTimeMs) {
          return res.status(400).json({ success: false, error: "Plane crashed! Too late to cash out." });
        }

        const progress = (msInRound - bettingDuration) / flyTimeMs;
        let currentMultiplier = 1.00 + (crashMultiplier - 1.00) * Math.pow(progress, 1.75);
        currentMultiplier = Math.min(crashMultiplier, Math.max(1.00, Math.round(currentMultiplier * 100) / 100));

        const payout = Math.floor(betData.bet * currentMultiplier);

        const userDoc = await userRef.get();
        const userData = userDoc.data() || {};

        await userRef.update({
          balance: Number(userData.balance || 0) + payout,
          aviatorWins: Number(userData.aviatorWins || 0) + 1,
          updatedAt: new Date().toISOString()
        });

        await betDocRef.update({
          cashedOut: true,
          multiplier: currentMultiplier,
          payout,
          cashedOutAt: new Date().toISOString()
        });

        return res.json({
          success: true,
          multiplier: currentMultiplier,
          payout
        });
      }

      return res.status(400).json({ success: false, error: "Invalid games action." });
    }

    // ----------------------------------------------------
    // 7. PROMO CODE SYSTEM
    // ----------------------------------------------------
    if (endpoint === "promo") {
      const code = String(req.body.code || "").trim().toUpperCase();
      if (!code) {
        return res.status(400).json({ success: false, error: "Enter a promo code." });
      }

      const promoDocRef = db.collection("promo_codes").doc(code);
      const promoDoc = await promoDocRef.get();

      if (!promoDoc.exists) {
        return res.status(400).json({ success: false, error: "Invalid or expired promo code." });
      }

      const promoData = promoDoc.data();
      if (promoData.claimedBy && promoData.claimedBy.includes(userId)) {
        return res.status(400).json({ success: false, error: "You have already claimed this promo code." });
      }

      const reward = Number(promoData.reward || 200);
      const userDoc = await userRef.get();
      const userData = userDoc.data() || {};

      await userRef.update({
        balance: Number(userData.balance || 0) + reward,
        updatedAt: new Date().toISOString()
      });

      await promoDocRef.update({
        claimedBy: admin.firestore.FieldValue.arrayUnion(userId),
        timesClaimed: (promoData.timesClaimed || 0) + 1
      });

      return res.json({ success: true, reward });
    }

    // ----------------------------------------------------
    // 8. COMMUNITY TASKS & DEPOSIT SYSTEM
    // ----------------------------------------------------
    if (endpoint === "tasks") {
      const action = req.body.action;

      if (action === "list") {
        const snap = await db.collection("tasks").where("active", "==", true).limit(20).get();
        const tasks = [];
        snap.forEach((doc) => tasks.push({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, tasks });
      }

      if (action === "complete") {
        const taskId = req.body.taskId;
        const taskRef = db.collection("tasks").doc(taskId);
        const taskDoc = await taskRef.get();

        if (!taskDoc.exists || !taskDoc.data().active) {
          return res.status(400).json({ success: false, error: "Task not found or expired." });
        }

        const taskData = taskDoc.data();
        if (taskData.completionsList && taskData.completionsList.includes(userId)) {
          return res.status(400).json({ success: false, error: "You already completed this task." });
        }

        // Verify Telegram membership if chatId is provided
        if (taskData.chatId) {
          const isMember = await checkChannelMembership(taskData.chatId, userId);
          if (!isMember) {
            return res.status(400).json({ success: false, error: "You must join the channel first." });
          }
        }

        const reward = Number(taskData.reward || 150);
        const newCompletions = Number(taskData.completions || 0) + 1;
        const isFinished = newCompletions >= Number(taskData.maxCompletions || 100);

        await taskRef.update({
          completions: newCompletions,
          active: !isFinished,
          completionsList: admin.firestore.FieldValue.arrayUnion(userId)
        });

        const userDoc = await userRef.get();
        const userData = userDoc.data() || {};

        await userRef.update({
          balance: Number(userData.balance || 0) + reward,
          tasksCompleted: Number(userData.tasksCompleted || 0) + 1,
          updatedAt: new Date().toISOString()
        });

        return res.json({ success: true, reward });
      }

      if (action === "create") {
        const { title, link, chatId, type } = req.body;
        const userDoc = await userRef.get();
        const userData = userDoc.data() || {};

        const isAdmin = userId === ADMIN_TELEGRAM_ID;
        const cost = 100000; // 100,000 PTS ($1.00)

        if (!isAdmin && Number(userData.balance || 0) < cost) {
          return res.status(400).json({ success: false, error: "Insufficient balance. 100,000 PTS ($1.00) required." });
        }

        if (!isAdmin) {
          await userRef.update({
            balance: Number(userData.balance || 0) - cost
          });
        }

        const newTaskRef = db.collection("tasks").doc();
        await newTaskRef.set({
          title,
          link,
          chatId,
          type: type || "channel",
          reward: 150,
          completions: 0,
          maxCompletions: 500,
          active: true,
          createdBy: userId,
          createdAt: new Date().toISOString()
        });

        return res.json({ success: true });
      }

      return res.status(400).json({ success: false, error: "Invalid tasks action." });
    }

    // ----------------------------------------------------
    // 9. DEPOSIT SYSTEM
    // ----------------------------------------------------
    if (endpoint === "deposit") {
      const action = req.body.action;

      if (action === "info") {
        return res.json({
          success: true,
          depositAddress: DEPOSIT_RECEIVING_ADDRESS || "Contact admin to configure deposit address."
        });
      }

      if (action === "submit") {
        const txHash = String(req.body.txHash || "").trim();
        if (!txHash) {
          return res.status(400).json({ success: false, error: "Transaction hash is required." });
        }

        await db.collection("deposit_requests").add({
          userId,
          txHash,
          status: "PENDING",
          createdAt: new Date().toISOString()
        });

        return res.json({ success: true });
      }

      return res.status(400).json({ success: false, error: "Invalid deposit action." });
    }

    // ----------------------------------------------------
    // 10. REFERRALS & LEADERBOARD
    // ----------------------------------------------------
    if (endpoint === "referral") {
      const action = req.body.action;

      if (action === "list") {
        const snap = await db.collection("referrals").where("referrerId", "==", userId).limit(50).get();
        const referrals = [];
        snap.forEach((doc) => referrals.push(doc.data()));
        return res.json({ success: true, referrals });
      }

      if (action === "leaderboard") {
        const snap = await db.collection("users").orderBy("referrals", "desc").limit(10).get();
        const leaderboard = [];
        snap.forEach((doc) => {
          const d = doc.data();
          leaderboard.push({
            firstName: d.firstName || "User",
            referrals: d.referrals || 0,
            referralPoints: d.referralPoints || 0
          });
        });
        return res.json({ success: true, leaderboard });
      }

      return res.status(400).json({ success: false, error: "Invalid referral action." });
    }

    // ----------------------------------------------------
    // 11. AUTOMATED ON-CHAIN WITHDRAWAL (MINIMUM 0.10 USDT)
    // ----------------------------------------------------
    if (endpoint === "withdraw") {
      const address = String(req.body.address || "").trim();
      if (!ethers.isAddress(address)) {
        return res.status(400).json({ success: false, error: "Invalid BEP20 address." });
      }

      const userDoc = await userRef.get();
      const userData = userDoc.data() || {};
      const balance = Number(userData.balance || 0);

      const minPoints = 10000; // 10,000 PTS = 0.10 USDT
      if (balance < minPoints) {
        return res.status(400).json({
          success: false,
          error: `Minimum withdrawal is 10,000 PTS (0.10 USDT). Current: ${balance} PTS.`
        });
      }

      const amountUsdt = (minPoints / 100000).toFixed(2); // "0.10"
      const txHash = await sendBscUsdt(address, amountUsdt);

      await userRef.update({
        balance: balance - minPoints,
        updatedAt: new Date().toISOString()
      });

      await db.collection("withdrawals").add({
        userId,
        address,
        amountUsdt,
        pointsDeducted: minPoints,
        txHash,
        createdAt: new Date().toISOString()
      });

      broadcastPaymentProof({
        type: "user_withdrawal",
        userId,
        amountUsdt,
        txHash,
        toAddress: address
      });

      return res.json({
        success: true,
        amount: amountUsdt,
        points: minPoints,
        txHash
      });
    }

    return res.status(404).json({ success: false, error: "ENDPOINT_NOT_FOUND" });
  } catch (error) {
    console.error(`API Route Error [${endpoint}]:`, error);
    return res.status(500).json({
      success: false,
      error: error.message || "INTERNAL_SERVER_ERROR"
    });
  }
};
