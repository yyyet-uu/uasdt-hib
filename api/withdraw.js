import { db, FieldValue } from "../lib/firebase.js";
import { validateInitData, getInitData } from "../lib/auth.js";
import { sendUSDT } from "../lib/payout.js";
import { sendMessage } from "../lib/telegram.js";
import { CONFIG } from "../lib/config.js";
import { ethers } from "ethers";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  let withdrawalId = null;

  try {
    const { user } =
      validateInitData(getInitData(req));

    const uid = String(user.id);

    const address =
      String(req.body?.address || "").trim();

    if (!ethers.isAddress(address)) {
      throw new Error("INVALID_ADDRESS");
    }

    const destination =
      ethers.getAddress(address);

    const userRef =
      db.collection("users").doc(uid);

    const withdrawalRef =
      db.collection("withdrawals").doc();

    const withdrawalPoints =
      Number(CONFIG.WITHDRAW_MIN_POINTS);

    const withdrawalAmount =
      withdrawalPoints /
      Number(CONFIG.POINTS_PER_USDT);

    await db.runTransaction(async tx => {
      const userSnap =
        await tx.get(userRef);

      if (!userSnap.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      const u = userSnap.data();

      if (!u.channelsVerified) {
        throw new Error("CHANNELS_REQUIRED");
      }

      const balance =
        Number(u.balance || 0);

      if (balance < withdrawalPoints) {
        throw new Error("MINIMUM_NOT_REACHED");
      }

      withdrawalId =
        withdrawalRef.id;

      // Reserve exactly 10,000 points.
      tx.update(userRef, {
        balance:
          FieldValue.increment(
            -withdrawalPoints
          ),

        withdrawals:
          FieldValue.increment(1),

        lastWithdrawalId:
          withdrawalId,

        updatedAt:
          FieldValue.serverTimestamp()
      });

      tx.create(withdrawalRef, {
        userId: uid,
        address: destination,

        points: withdrawalPoints,

        amountUSDT:
          Number(
            withdrawalAmount.toFixed(8)
          ),

        status: "processing",

        createdAt:
          FieldValue.serverTimestamp()
      });
    });

    const payment =
      await sendUSDT(
        destination,
        Number(
          withdrawalAmount.toFixed(8)
        )
      );

    await withdrawalRef.update({
      status: "paid",
      txHash: payment.txHash,
      paidAt:
        FieldValue.serverTimestamp()
    });

    try {
      await sendMessage(
        uid,
        `✅ <b>Withdrawal successful!</b>\n\n💰 0.10 USDT\n📍 ${destination}\n🔗 ${payment.txHash}`
      );
    } catch {}

    return res.json({
      success: true,
      amount: 0.10,
      points: withdrawalPoints,
      txHash: payment.txHash
    });

  } catch (error) {
    console.error(
      "WITHDRAW ERROR:",
      error
    );

    // Refund the reserved points if payment failed.
    if (withdrawalId) {
      try {
        const withdrawalRef =
          db.collection("withdrawals")
            .doc(withdrawalId);

        const withdrawalSnap =
          await withdrawalRef.get();

        if (withdrawalSnap.exists) {
          const data =
            withdrawalSnap.data();

          if (data.status === "processing") {
            await db.runTransaction(
              async tx => {
                tx.update(
                  db.collection("users")
                    .doc(data.userId),
                  {
                    balance:
                      FieldValue.increment(
                        Number(data.points || 0)
                      ),

                    updatedAt:
                      FieldValue.serverTimestamp()
                  }
                );

                tx.update(
                  withdrawalRef,
                  {
                    status: "failed",
                    error: error.message,
                    updatedAt:
                      FieldValue.serverTimestamp()
                  }
                );
              }
            );
          }
        }
      } catch (refundError) {
        console.error(
          "REFUND ERROR:",
          refundError
        );
      }
    }

    return res.status(400).json({
      success: false,
      error:
        error.message ||
        "Withdrawal failed"
    });
  }
                  }
