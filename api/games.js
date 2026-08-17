import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    })
  });
}

const db = admin.firestore();

const XO_DAILY_LIMIT = 3;
const XO_ENTRY = 100;
const XO_WIN = 180;

const AVIATOR_ENTRY = 100;
const AVIATOR_MAX_MULTIPLIER = 10;

function todayKey() {
  const d = new Date();

  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function randomMultiplier() {
  // Lower average payout / frequent crashes.
  const r = Math.random();

  if (r < 0.55) return 1.00;
  if (r < 0.75) return 1.20;
  if (r < 0.88) return 1.50;
  if (r < 0.96) return 2.00;
  if (r < 0.985) return 3.00;
  if (r < 0.995) return 5.00;

  return 10.00;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const {
      action,
      telegramId,
      choice,
      bet
    } = req.body || {};

    if (!telegramId) {
      return res.status(400).json({
        success: false,
        error: "Telegram ID is required"
      });
    }

    const userRef = db
      .collection("users")
      .doc(String(telegramId));

    /* =========================
       XO GAME
    ========================= */

    if (action === "xo") {
      if (!["x", "o"].includes(String(choice).toLowerCase())) {
        return res.status(400).json({
          success: false,
          error: "Choose X or O"
        });
      }

      let result;

      await db.runTransaction(async transaction => {
        const snap = await transaction.get(userRef);

        if (!snap.exists) {
          throw new Error("USER_NOT_FOUND");
        }

        const user = snap.data();
        const today = todayKey();

        let plays = Number(user.xoDailyPlays || 0);

        if (user.xoPlayDate !== today) {
          plays = 0;
        }

        if (plays >= XO_DAILY_LIMIT) {
          throw new Error("XO_LIMIT");
        }

        const balance = Number(user.balance || 0);

        if (balance < XO_ENTRY) {
          throw new Error("INSUFFICIENT_POINTS");
        }

        plays++;

        // Simple random result.
        // The house has a slight edge.
        const win = Math.random() < 0.42;

        const reward = win ? XO_WIN : 0;
        const newBalance =
          balance - XO_ENTRY + reward;

        transaction.update(userRef, {
          balance: newBalance,
          xoDailyPlays: plays,
          xoPlayDate: today,
          xoPlays:
            admin.firestore.FieldValue.increment(1),
          xoWins:
            win
              ? admin.firestore.FieldValue.increment(1)
              : admin.firestore.FieldValue.increment(0),
          updatedAt:
            admin.firestore.FieldValue.serverTimestamp()
        });

        result = {
          win,
          reward,
          entry: XO_ENTRY,
          plays,
          remaining: XO_DAILY_LIMIT - plays,
          balance: newBalance
        };
      });

      return res.status(200).json({
        success: true,
        game: "xo",
        ...result
      });
    }

    /* =========================
       AVIATOR
    ========================= */

    if (action === "aviator") {
      const amount = Number(bet);

      if (
        !Number.isInteger(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid bet"
        });
      }

      if (amount > 100000) {
        return res.status(400).json({
          success: false,
          error: "Maximum bet is 100,000 points"
        });
      }

      let result;

      await db.runTransaction(async transaction => {
        const snap = await transaction.get(userRef);

        if (!snap.exists) {
          throw new Error("USER_NOT_FOUND");
        }

        const user = snap.data();
        const balance = Number(user.balance || 0);

        if (balance < amount) {
          throw new Error("INSUFFICIENT_POINTS");
        }

        const multiplier = randomMultiplier();

        /*
          The game ends at the generated multiplier.
          The frontend may display the animation,
          but the server decides the result.
        */

        const won = multiplier > 1;

        const payout = won
          ? Math.floor(amount * multiplier)
          : 0;

        const newBalance =
          balance - amount + payout;

        transaction.update(userRef, {
          balance: newBalance,

          aviatorGames:
            admin.firestore.FieldValue.increment(1),

          aviatorWins:
            won
              ? admin.firestore.FieldValue.increment(1)
              : admin.firestore.FieldValue.increment(0),

          updatedAt:
            admin.firestore.FieldValue.serverTimestamp()
        });

        const gameRef =
          db.collection("gameResults").doc();

        transaction.set(gameRef, {
          telegramId: String(telegramId),
          game: "aviator",
          bet: amount,
          multiplier,
          payout,
          won,
          createdAt:
            admin.firestore.FieldValue.serverTimestamp()
        });

        result = {
          bet: amount,
          multiplier,
          payout,
          won,
          balance: newBalance
        };
      });

      return res.status(200).json({
        success: true,
        game: "aviator",
        ...result
      });
    }

    return res.status(400).json({
      success: false,
      error: "Unknown game action"
    });

  } catch (error) {
    console.error("GAME ERROR:", error);

    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    if (error.message === "XO_LIMIT") {
      return res.status(429).json({
        success: false,
        error: "XO daily limit reached",
        limit: XO_DAILY_LIMIT
      });
    }

    if (error.message === "INSUFFICIENT_POINTS") {
      return res.status(400).json({
        success: false,
        error: "Not enough points"
      });
    }

    return res.status(500).json({
      success: false,
      error: "Game failed"
    });
  }
}
