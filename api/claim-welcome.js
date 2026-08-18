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

  let payoutId = null;

  try {
    const { user } =
      validateInitData(getInitData(req));

    const uid = String(user.id);
    const address =
      String(req.body.address || "").trim();

    if (!ethers.isAddress(address)) {
      return res.status(400).json({
        success: false,
        error: "Invalid BEP20 address"
      });
    }

    const normalized =
      ethers.getAddress(address);

    const userRef =
      db.collection("users").doc(uid);

    const addressRef =
      db.collection("welcomeClaims")
        .doc(normalized.toLowerCase());

    const payoutRef =
      db.collection("payouts").doc();

    await db.runTransaction(async tx => {
      const userSnap =
        await tx.get(userRef);

      const addressSnap =
        await tx.get(addressRef);

      if (!userSnap.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      const u = userSnap.data();

      if (!u.channelsVerified) {
        throw new Error("CHANNELS_REQUIRED");
      }

      if (u.welcomeBonusClaimed) {
        throw new Error("WELCOME_ALREADY_CLAIMED");
      }

      if (addressSnap.exists) {
        throw new Error("ADDRESS_ALREADY_USED");
      }

      payoutId = payoutRef.id;

      tx.set(addressRef, {
        userId: uid,
        address: normalized,
        payoutId,
        createdAt:
          FieldValue.serverTimestamp()
      });

      tx.set(payoutRef, {
        type: "welcome",
        userId: uid,
        address: normalized,
        amount: CONFIG.WELCOME_USDT,
        status: "processing",
        createdAt:
          FieldValue.serverTimestamp()
      });

      tx.update(userRef, {
        welcomeBonusClaimed: true,
        welcomeBonusStatus: "processing",
        welcomeAddress: normalized,
        appUnlocked: true,
        updatedAt:
          FieldValue.serverTimestamp()
      });
    });

    const payment =
      await sendUSDT(
        normalized,
        CONFIG.WELCOME_USDT
      );

    await payoutRef.update({
      status: "paid",
      txHash: payment.txHash,
      paidAt:
        FieldValue.serverTimestamp()
    });

    await userRef.update({
      welcomeBonusStatus: "paid",
      updatedAt:
        FieldValue.serverTimestamp()
    });

    try {
      await sendMessage(
        uid,
        `🎁 <b>Welcome bonus sent!</b>\n\n💰 ${CONFIG.WELCOME_USDT} USDT\n🔗 ${payment.txHash}`
      );
    } catch {}

    return res.json({
      success: true,
      amount: CONFIG.WELCOME_USDT,
      txHash: payment.txHash
    });

  } catch (error) {
    console.error(error);

    if (payoutId) {
      try {
        await db.collection("payouts")
          .doc(payoutId)
          .update({
            status: "failed",
            error: error.message,
            updatedAt:
              FieldValue.serverTimestamp()
          });
      } catch {}
    }

    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
}
