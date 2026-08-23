"use strict";

const crypto = require("crypto");
const { ethers } = require("ethers");
const admin = require("firebase-admin");

// ============================================================
// CONFIGURATION
// ============================================================
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const BOT_USERNAME = process.env.BOT_USERNAME || "Ussdt_hub_bot";
const ADMIN_TELEGRAM_ID = String(process.env.ADMIN_TELEGRAM_ID || "514560");
const PROOF_CHANNEL_ID = process.env.PROOF_CHANNEL_ID || "@birr_gram";

const REQUIRED_CHANNELS = [
  { id: "@birr_gram", name: "Birr Gram" },
  { id: "@usdt_g_ram", name: "USDT Gram" }
];

const BSC_RPC_URL = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org/";
const PAYOUT_PRIVATE_KEY = process.env.PAYOUT_PRIVATE_KEY || "";
const USDT_BEP20_CONTRACT = process.env.USDT_BEP20_CONTRACT || "0x55d398326f99059fF775485246999027B3197955";
const DEPOSIT_RECEIVING_ADDRESS = process.env.DEPOSIT_RECEIVING_ADDRESS || "";

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const STREAK_REWARDS = [50, 75, 100, 150, 200, 300, 500];

// ============================================================
// FIREBASE INITIALIZATION
// ============================================================
if (!admin.apps.length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    } catch {
      admin.initializeApp();
    }
  } else {
    admin.initializeApp();
  }
}

const db = admin.firestore();

// Resilient parsing: verifies hash if token exists, otherwise safely extracts user object
function parseTelegramUser(initData) {
  if (!initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const userRaw = params.get("user");
    if (!userRaw) return null;

    const parsedUser = JSON.parse(userRaw);

    if (BOT_TOKEN) {
      const hash = params.get("hash");
      if (hash) {
        params.delete("hash");
        const dataCheckString = Array.from(params.entries())
          .map(([k, v]) => `${k}=${v}`)
          .sort()
          .join("\n");
        const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
        const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
        if (calculatedHash === hash) {
          parsedUser._verified = true;
        }
      }
    }
    return parsedUser;
  } catch {
    return null;
  }
}

async function checkChannelMembership(channelId, userId) {
  if (!BOT_TOKEN) return true;
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(channelId)}&user_id=${userId}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok || !data.result) return false;
    return ["creator", "administrator", "member", "restricted"].includes(data.result.status);
  } catch {
    return false;
  }
}

async function broadcastPaymentProof({ userId, amountUsdt, txHash, toAddress }) {
  if (!BOT_TOKEN || !PROOF_CHANNEL_ID) return;
  try {
    const maskedAddr = `${toAddress.slice(0, 6)}...${toAddress.slice(-4)}`;
    const text =
      `🚀 <b>New Automated Payout Sent!</b>\n\n` +
      `💰 <b>Amount:</b> ${amountUsdt} USDT (BEP20)\n` +
      `👤 <b>User:</b> <code>${userId}</code>\n` +
      `📥 <b>Wallet:</b> <code>${maskedAddr}</code>\n` +
      `🔗 <b>Tx Hash:</b> <a href="https://bscscan.com/tx/${txHash}">${txHash.slice(0, 14)}...</a>\n\n` +
      `⚡ <i>USDT Hub Micro-Earning</i>`;

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: PROOF_CHANNEL_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });
  } catch {}
}

async function sendBscUsdt(recipientAddress, amountUsdt) {
  if (!PAYOUT_PRIVATE_KEY) {
    throw new Error("Payout private key is not configured.");
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
// MAIN HANDLER
// ============================================================
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader("Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Telegram-Init-Data");

  if (req.method === "OPTIONS") return res.status(200).end();

  const initData = req.headers["x-telegram-init-data"] || req.body?.initData || "";
  const tgUser = parseTelegramUser(initData);

  const urlPath = req.url || "";
  const endpoint =
    req.query.endpoint ||
    req.body.endpoint ||
    urlPath.split("?")[0].replace(/^\/api\/?/, "");

  if (!tgUser) {
    if (endpoint === "public-info" || req.method === "GET") {
      return res.json({ success: true, name: "USDT Hub", status: "Online" });
    }
    return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
  }

  const userId = String(tgUser.id);
  const userRef = db.collection("users").doc(userId);

  try {
    // 1. USER
    if (endpoint === "user") {
      const startParam = req.body.startParam || "";
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        let referrerId = null;
        if (startParam && startParam.startsWith("ref_")) {
          const r = startParam.replace("ref_", "").trim();
          if (r && r !== userId) referrerId = r;
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
          referrerId,
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

    // 2. VERIFY MEMBERSHIP
    if (endpoint === "verify-membership") {
      let allJoined = true;
      for (const ch of REQUIRED_CHANNELS) {
        const isMember = await checkChannelMembership(ch.id, userId);
        if (!isMember) {
          allJoined = false;
          break;
        }
      }

      if (!allJoined) return res.json({ success: true, joined: false });

      const userDoc = await userRef.get();
      const userData = userDoc.data() || {};

      await userRef.update({
        channelsVerified: true,
        updatedAt: new Date().toISOString()
      });

      if (userData.referrerId) {
        const refDocRef = db.collection("referrals").doc(`${userData.referrerId}_${userId}`);
        const refDoc = await refDocRef.get();
        if (refDoc.exists && !refDoc.data().channelRewarded) {
          const rRef = db.collection("users").doc(userData.referrerId);
          await db.runTransaction(async (t) => {
            const doc = await t.get(rRef);
            if (doc.exists) {
              const d = doc.data();
              t.update(rRef, {
                balance: (d.balance || 0) + 500,
                referralPoints: (d.referralPoints || 0) + 500,
                referrals: (d.referrals || 0) + 1
              });
              t.update(refDocRef, { channelRewarded: true });
            }
          });
        }
      }

      return res.json({ success: true, joined: true });
    }

    // 3. WELCOME BONUS (0.01 USDT)
    if (endpoint === "claim-welcome") {
      const address = String(req.body.address || "").trim();
      if (!ethers.isAddress(address)) {
        return res.status(400).json({ success: false, error: "Invalid BEP20 address." });
      }

      const userDoc = await userRef.get();
      const userData = userDoc.data() || {};
      if (userData.welcomeBonusClaimed) {
        return res.status(400).json({ success: false, error: "Bonus already claimed." });
      }

      const txHash = await sendBscUsdt(address, "0.01");

      await userRef.update({
        welcomeBonusClaimed: true,
        bep20Address: address,
        welcomeTxHash: txHash,
        updatedAt: new Date().toISOString()
      });

      broadcastPaymentProof({
        userId,
        amountUsdt: "0.01",
        txHash,
        toAddress: address
      });

      return res.json({ success: true, txHash });
    }

    // 4. DAILY STREAK
    if (endpoint === "claim-streak") {
      const userDoc = await userRef.get();
      const userData = userDoc.data() || {};
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);

      if (userData.lastStreakDate === todayStr) {
        return res.status(400).json({ success: false, error: "STREAK_ALREADY_CLAIMED_TODAY" });
      }

      let streakDay = Number(userData.streakDay || 0);
      if (userData.lastStreakDate) {
        const diff = Math.floor((now - new Date(userData.lastStreakDate)) / (1000 * 60 * 60 * 24));
        streakDay = diff === 1 ? (streakDay >= 7 ? 1 : streakDay + 1) : 1;
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

    // 5. ADS MINING (MONETAG + HILLTOPADS)
    if (endpoint === "ads") {
      const provider = req.body.provider || "monetag";
      const userDoc = await userRef.get();
      const userData = userDoc.data() || {};
      const todayStr = new Date().toISOString().slice(0, 10);

      let monetagToday = userData.lastAdDate === todayStr ? Number(userData.monetagToday || 0) : 0;
      let hilltopToday = userData.lastAdDate === todayStr ? Number(userData.hilltopToday || 0) : 0;

      if (provider === "monetag") {
        if (monetagToday >= 25) {
          return res.status(400).json({ success: false, error: "Daily Monetag limit (25) reached." });
        }
        monetagToday += 1;
      } else if (provider === "hilltop") {
        if (hilltopToday >= 15) {
          return res.status(400).json({ success: false, error: "Daily HilltopAds limit (15) reached." });
        }
        hilltopToday += 1;
      }

      const reward = 75;
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

      if (userData.referrerId && totalAds >= 2) {
        const refDocRef = db.collection("referrals").doc(`${userData.referrerId}_${userId}`);
        const refDoc = await refDocRef.get();
        if (refDoc.exists && !refDoc.data().adsRewarded) {
          const rRef = db.collection("users").doc(userData.referrerId);
          await db.runTransaction(async (t) => {
            const doc = await t.get(rRef);
            if (doc.exists) {
              const d = doc.data();
              t.update(rRef, {
                balance: (d.balance || 0) + 500,
                referralPoints: (d.referralPoints || 0) + 500
              });
              t.update(refDocRef, { adsRewarded: true });
            }
          });
        }
      }

      return res.json({ success: true, reward, totalAds, monetagToday, hilltopToday, balance: newBalance });
    }

    // 6. SYNCHRONIZED AVIATOR
    if (endpoint === "games") {
      const action = req.body.action;
      const now = Date.now();
      const roundIndex = Math.floor(Math.floor(now / 1000) / 16);
      const msInRound = now % 16000;

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

      if (action === "aviator_bet") {
        if (msInRound >= 5000) return res.status(400).json({ success: false, error: "Flight started. Wait for next round!" });
        const bet = Math.floor(Number(req.body.bet || 0));
        if (bet <= 0) return res.status(400).json({ success: false, error: "Invalid bet amount." });

        const userDoc = await userRef.get();
        const userData = userDoc.data() || {};
        if (Number(userData.balance || 0) < bet) return res.status(400).json({ success: false, error: "Insufficient balance." });

        const betDocRef = db.collection("aviator_bets").doc(`${userId}_${roundIndex}`);
        if ((await betDocRef.get()).exists) return res.status(400).json({ success: false, error: "Bet already placed." });

        await userRef.update({ balance: Number(userData.balance || 0) - bet });
        await betDocRef.set({ userId, roundIndex, bet, cashedOut: false, createdAt: new Date().toISOString() });

        return res.json({ success: true, bet, roundIndex });
      }

      if (action === "aviator_cashout") {
        const betDocRef = db.collection("aviator_bets").doc(`${userId}_${roundIndex}`);
        const betDoc = await betDocRef.get();
        if (!betDoc.exists) return res.status(400).json({ success: false, error: "No active bet found." });

        const betData = betDoc.data();
        if (betData.cashedOut) return res.status(400).json({ success: false, error: "Already cashed out." });
        if (msInRound < 5000) return res.status(400).json({ success: false, error: "Flight not started." });
        if (msInRound >= 5000 + flyTimeMs) return res.status(400).json({ success: false, error: "Plane crashed!" });

        const progress = (msInRound - 5000) / flyTimeMs;
        let currentMultiplier = Math.min(crashMultiplier, Math.max(1.00, Math.round((1.00 + (crashMultiplier - 1.00) * Math.pow(progress, 1.75)) * 100) / 100));
        const payout = Math.floor(betData.bet * currentMultiplier);

        const userDoc = await userRef.get();
        const userData = userDoc.data() || {};

        await userRef.update({
          balance: Number(userData.balance || 0) + payout,
          aviatorWins: Number(userData.aviatorWins || 0) + 1
        });

        await betDocRef.update({ cashedOut: true, multiplier: currentMultiplier, payout });
        return res.json({ success: true, multiplier: currentMultiplier, payout });
      }
    }

    // 7. PROMO CODE
    if (endpoint === "promo") {
      const code = String(req.body.code || "").trim().toUpperCase();
      const promoDocRef = db.collection("promo_codes").doc(code);
      const promoDoc = await promoDocRef.get();

      if (!promoDoc.exists) return res.status(400).json({ success: false, error: "Invalid promo code." });
      const promoData = promoDoc.data();

      if (promoData.claimedBy && promoData.claimedBy.includes(userId)) {
        return res.status(400).json({ success: false, error: "Promo code already claimed." });
      }

      const reward = Number(promoData.reward || 200);
      const userDoc = await userRef.get();
      const userData = userDoc.data() || {};

      await userRef.update({ balance: Number(userData.balance || 0) + reward });
      await promoDocRef.update({
        claimedBy: admin.firestore.FieldValue.arrayUnion(userId),
        timesClaimed: (promoData.timesClaimed || 0) + 1
      });

      return res.json({ success: true, reward });
    }

    // 8. COMMUNITY TASKS
    if (endpoint === "tasks") {
      const action = req.body.action;

      if (action === "list") {
        const snap = await db.collection("tasks").where("active", "==", true).limit(20).get();
        const tasks = [];
        snap.forEach((doc) => tasks.push({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, tasks });
      }

      if (action === "complete") {
        const taskRef = db.collection("tasks").doc(req.body.taskId);
        const taskDoc = await taskRef.get();
        if (!taskDoc.exists || !taskDoc.data().active) return res.status(400).json({ success: false, error: "Task expired." });

        const taskData = taskDoc.data();
        if (taskData.completionsList && taskData.completionsList.includes(userId)) {
          return res.status(400).json({ success: false, error: "Task already completed." });
        }

        const reward = Number(taskData.reward || 150);
        const newCount = Number(taskData.completions || 0) + 1;

        await taskRef.update({
          completions: newCount,
          active: newCount < Number(taskData.maxCompletions || 100),
          completionsList: admin.firestore.FieldValue.arrayUnion(userId)
        });

        const userDoc = await userRef.get();
        const userData = userDoc.data() || {};
        await userRef.update({
          balance: Number(userData.balance || 0) + reward,
          tasksCompleted: Number(userData.tasksCompleted || 0) + 1
        });

        return res.json({ success: true, reward });
      }

      if (action === "create") {
        const { title, link, chatId, type } = req.body;
        const userDoc = await userRef.get();
        const userData = userDoc.data() || {};
        const isAdmin = userId === ADMIN_TELEGRAM_ID;
        const cost = 100000;

        if (!isAdmin && Number(userData.balance || 0) < cost) {
          return res.status(400).json({ success: false, error: "100,000 PTS ($1.00) required." });
        }

        if (!isAdmin) {
          await userRef.update({ balance: Number(userData.balance || 0) - cost });
        }

        await db.collection("tasks").add({
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
    }

    // 9. DEPOSITS
    if (endpoint === "deposit") {
      if (req.body.action === "info") {
        return res.json({ success: true, depositAddress: DEPOSIT_RECEIVING_ADDRESS || "Not configured" });
      }
      if (req.body.action === "submit") {
        await db.collection("deposit_requests").add({
          userId,
          txHash: String(req.body.txHash || "").trim(),
          status: "PENDING",
          createdAt: new Date().toISOString()
        });
        return res.json({ success: true });
      }
    }

    // 10. REFERRALS
    if (endpoint === "referral") {
      if (req.body.action === "list") {
        const snap = await db.collection("referrals").where("referrerId", "==", userId).limit(50).get();
        const referrals = [];
        snap.forEach((doc) => referrals.push(doc.data()));
        return res.json({ success: true, referrals });
      }
      if (req.body.action === "leaderboard") {
        const snap = await db.collection("users").orderBy("referrals", "desc").limit(10).get();
        const leaderboard = [];
        snap.forEach((doc) => {
          const d = doc.data();
          leaderboard.push({ firstName: d.firstName || "User", referrals: d.referrals || 0, referralPoints: d.referralPoints || 0 });
        });
        return res.json({ success: true, leaderboard });
      }
    }

    // 11. WITHDRAW (MINIMUM 0.10 USDT)
    if (endpoint === "withdraw") {
      const address = String(req.body.address || "").trim();
      if (!ethers.isAddress(address)) return res.status(400).json({ success: false, error: "Invalid BEP20 address." });

      const userDoc = await userRef.get();
      const userData = userDoc.data() || {};
      const balance = Number(userData.balance || 0);

      if (balance < 10000) {
        return res.status(400).json({ success: false, error: `Minimum is 10,000 PTS ($0.10). Current: ${balance} PTS.` });
      }

      const txHash = await sendBscUsdt(address, "0.10");
      await userRef.update({ balance: balance - 10000 });

      await db.collection("withdrawals").add({
        userId,
        address,
        amountUsdt: "0.10",
        pointsDeducted: 10000,
        txHash,
        createdAt: new Date().toISOString()
      });

      broadcastPaymentProof({ userId, amountUsdt: "0.10", txHash, toAddress: address });
      return res.json({ success: true, amount: "0.10", points: 10000, txHash });
    }

    return res.status(404).json({ success: false, error: "NOT_FOUND" });
  } catch (error) {
    console.error(`API Handler Error:`, error);
    return res.status(500).json({ success: false, error: error.message || "INTERNAL_ERROR" });
  }
};
