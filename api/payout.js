import { db } from "../lib/firebase.js";
import { sendUSDT } from "../lib/payout.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  const adminId =
    String(req.body.telegramId || "");

  if (
    adminId !==
    String(process.env.TELEGRAM_ADMIN_ID)
  ) {
    return res.status(403).json({
      success: false,
      error: "Forbidden"
    });
  }

  try {
    const {
      withdrawalId
    } = req.body;

    if (!withdrawalId) {
      throw new Error("WITHDRAWAL_ID_REQUIRED");
    }

    const ref =
      db.collection("withdrawals")
        .doc(withdrawalId);

    const snap = await ref.get();

    if (!snap.exists) {
      throw new Error("WITHDRAWAL_NOT_FOUND");
    }

    const data = snap.data();

    if (data.status === "paid") {
      return res.json({
        success: true,
        txHash: data.txHash
      });
    }

    const payment =
      await sendUSDT(
        data.address,
        data.amountUSDT
      );

    await ref.update({
      status: "paid",
      txHash: payment.txHash,
      paidAt:
        new Date()
    });

    return res.json({
      success: true,
      txHash: payment.txHash
    });

  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  }
