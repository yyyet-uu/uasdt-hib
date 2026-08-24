import crypto from "crypto";
import { db, FieldValue } from "../lib/firebase.js";
import { validateInitData, getInitData } from "../lib/auth.js";
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

    if (path === "/api/user" || endpoint === "user") {
      let { user, startParam } = getUser(req);
      const uid = String(user.id);

      if (!startParam && req.body?.startParam) {
        startParam = String(req.body.startParam).trim();
      }

      if (!db) {
        throw new Error("Database not initialized. Check Firebase environment variables on Vercel.");
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

      const userData = {
        telegramId: uid,
        firstName: user.first_name || "",
        lastName: user.last_name || "",
        username: user.username || "",
        balance: 0,
        adsWatched: 0,
        monetagToday: 0,
        hilltopToday: 0,
        tasksCompleted: 0,
        referrals: 0,
        referralPoints: 0,
        welcomeBonusClaimed: false,
        channelsVerified: false,
        appUnlocked: false,
        streakDay: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      };

      await userRef.set(userData);

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

    if (path === "/api/tasks" || endpoint === "tasks") {
      return res.status(200).json({ success: true, tasks: [] });
    }

    if (path === "/api/referral" || endpoint === "referral") {
      return res.status(200).json({ success: true, referrals: [], leaderboard: [] });
    }

    if (path === "/api/transactions" || endpoint === "transactions") {
      return res.status(200).json({ success: true, transactions: [] });
    }

    return res.status(200).json({
      success: true,
      message: "Endpoint processed safely"
    });
  } catch (error) {
    console.error("USDT HUB API ERROR:", error);
    return res.status(200).json({
      success: false,
      error: error?.message || String(error)
    });
  }
}
