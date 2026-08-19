import { db, FieldValue } from "../lib/firebase.js";
import { sendUSDT } from "../lib/payout.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const adminId =
      String(req.body?.telegramId || "");

    if (
      adminId !==
      String(process.env.TELEGRAM_ADMIN_ID)
    ) {
      return res.status(403).json({
        success: false,
        error: "Forbidden"
      });
    }

    const withdrawalId =
      String(req.body?.withdrawalId || "");

    if (!withdrawalId) {
      throw new Error(
        "WITHDRAWAL_ID_REQUIRED"
      );
    }

    const withdrawalRef =
      db.collection("withdrawals")
        .doc(withdrawalId);

    let paymentData = null;

    await db.runTransaction(async tx => {
      const snap =
        await tx.get(withdrawalRef);

      if (!snap.exists) {
        throw new Error(
          "WITHDRAWAL_NOT_FOUND"
        );
      }

      const data = snap.data();

      if (data.status === "paid") {
        paymentData = {
          alreadyPaid: true,
          txHash: data.txHash
        };
        return;
      }

      if (data.status !== "processing") {
        throw new Error(
          "WITHDRAWAL_NOT_PROCESSING"
        );
      }

      tx.update(withdrawalRef, {
        status: "paying",
        updatedAt:
          FieldValue.serverTimestamp()
      });
    });

    if (paymentData?.alreadyPaid) {
      return res.json({
        success: true,
        txHash: paymentData.txHash,
        alreadyPaid: true
      });
    }

    const snap =
      await withdrawalRef.get();

    const data = snap.data();

    const payment =
      await sendUSDT(
        data.address,
        data.amountUSDT
      );

    await withdrawalRef.update({
      status: "paid",
      txHash: payment.txHash,
      paidAt:
        FieldValue.serverTimestamp()
    });

    return res.json({
      success: true,
      txHash: payment.txHash
    });

  } catch (error) {
    console.error(
      "ADMIN PAYOUT ERROR:",
      error
    );

    return res.status(400).json({
      success: false,
      error:
        error.message ||
        "Payout failed"
    });
  }
}
