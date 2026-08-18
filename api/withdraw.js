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
      String(req.body.address || "").trim();

    if (!ethers.isAddress(address)) {
      throw new Error("INVALID_ADDRESS");
    }

    const destination =
      ethers.getAddress(address);

    const userRef =
      db.collection("users").doc(uid);

    const withdrawalRef =
      db.collection("withdrawals").doc();

    await db.runTransaction(async tx => {
      const snap =
        await tx.get(userRef);

      if (!snap.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      const u = snap.data();

      if (!u.channelsVerified) {
        throw new Error("CHANNELS_REQUIRED");
      }

      const points =
        Number(u.balance || 0);

      if (
        points <
        CONFIG.WITHDRAW_MIN_POINTS
      ) {
        throw new Error("MINIMUM_NOT_REACHED");
      }

      withdrawalId =
        withdrawalRef.id;

      tx.update(userRef, {
        balance:
          FieldValue.increment(-points),

        withdrawals:
          FieldValue.increment(1),

        lastWithdrawalId:
          withdrawalId
      });

      tx.create(withdrawalRef, {
        userId: uid,
        address: destination,

        points,

        amountUSDT:
          points /
          CONFIG.POINTS_PER_USDT,

        status: "processing",

        createdAt:
          FieldValue.serverTimestamp()
      });
    });

    const amount =
      Number(
        (
          Number(
            (await withdrawalRef.get()).data()
              .amountUSDT
          )
        ).toFixed(8)
      );

    const payment =
      await sendUSDT(
        destination,
        amount
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
        `✅ <b>Withdrawal successful</b>\n\n💰 ${amount} USDT\n🔗 ${payment.txHash}`
      );
    } catch {}

    return res.json({
      success: true,
      amount,
      txHash: payment.txHash
    });

  } catch (error) {
    console.error(error);

    if (withdrawalId) {
      try {
        const ref =
          db.collection("withdrawals")
            .doc(withdrawalId);

        const snap = await ref.get();

        if (
          snap.exists &&
          snap.data().status === "processing"
        ) {
          const data = snap.data();

          await db.runTransaction(async tx => {
            tx.update(
              db.collection("users").doc(
                data.userId
              ),
              {
                balance:
                  FieldValue.increment(
                    Number(data.points || 0)
                  )
              }
            );

            tx.update(ref, {
              status: "failed",
              error: error.message,
              updatedAt:
                FieldValue.serverTimestamp()
            });
          });
        }
      } catch {}
    }

    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
        }
