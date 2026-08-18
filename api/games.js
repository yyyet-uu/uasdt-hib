import { db, FieldValue } from "../lib/firebase.js";
import { validateInitData, getInitData } from "../lib/auth.js";
import { CONFIG } from "../lib/config.js";

function today() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const { user } =
      validateInitData(getInitData(req));

    const uid = String(user.id);
    const action = req.body.action;

    const userRef =
      db.collection("users").doc(uid);

    if (action === "xo") {
      const choice =
        String(req.body.choice || "")
          .toLowerCase();

      if (!["x", "o"].includes(choice)) {
        throw new Error("INVALID_CHOICE");
      }

      let result;

      await db.runTransaction(async tx => {
        const snap =
          await tx.get(userRef);

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
          CONFIG.XO_ENTRY
        ) {
          throw new Error("INSUFFICIENT_POINTS");
        }

        plays++;

        const win =
          Math.random() < 0.42;

        const payout =
          win ? CONFIG.XO_WIN : 0;

        const newBalance =
          Number(u.balance || 0) -
          CONFIG.XO_ENTRY +
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
              : FieldValue.increment(0)
        });

        result = {
          win,
          payout,
          plays,
          remaining:
            CONFIG.XO_LIMIT - plays,
          balance: newBalance
        };
      });

      return res.json({
        success: true,
        ...result
      });
    }

    if (action === "aviator") {
      const bet =
        Number(req.body.bet);

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
        const snap =
          await tx.get(userRef);

        if (!snap.exists) {
          throw new Error("USER_NOT_FOUND");
        }

        const u = snap.data();

        if (Number(u.balance || 0) < bet) {
          throw new Error("INSUFFICIENT_POINTS");
        }

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

        const balance =
          Number(u.balance || 0) -
          bet +
          payout;

        tx.update(userRef, {
          balance,

          aviatorGames:
            FieldValue.increment(1),

          aviatorWins:
            multiplier > 1
              ? FieldValue.increment(1)
              : FieldValue.increment(0)
        });

        result = {
          bet,
          multiplier,
          payout,
          balance
        };
      });

      return res.json({
        success: true,
        ...result
      });
    }

    throw new Error("UNKNOWN_GAME");

  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
      }
