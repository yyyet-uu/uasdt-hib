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

const MIN_POINTS = 10000;
const POINTS_PER_USDT = 100000;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

function isValidBep20Address(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

async function sendTelegram(chatId, text) {
  if (!BOT_TOKEN || !chatId) return;

  await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML"
      })
    }
  );
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
      telegramId,
      bep20Address
    } = req.body || {};

    if (!telegramId) {
      return res.status(400).json({
        success: false,
        error: "Telegram ID is required"
      });
    }

    if (!bep20Address) {
      return res.status(400).json({
        success: false,
        error: "BEP20 address is required"
      });
    }

    const address = bep20Address.trim();

    if (!isValidBep20Address(address)) {
      return res.status(400).json({
        success: false,
        error: "Invalid BEP20 address"
      });
    }

    const userRef = db
      .collection("users")
      .doc(String(telegramId));

    const withdrawalRef = db
      .collection("withdrawals")
      .doc();

    let withdrawalData;

    await db.runTransaction(async transaction => {

      const userSnap = await transaction.get(userRef);

      if (!userSnap.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      const user = userSnap.data();

      const points = Number(user.balance || 0);

      if (points < MIN_POINTS) {
        throw new Error("INSUFFICIENT_POINTS");
      }

      if (!user.channelsVerified) {
        throw new Error("CHANNELS_NOT_VERIFIED");
      }

      if (!user.welcomeAddress) {
        throw new Error("NO_WALLET_ADDRESS");
      }

      withdrawalData = {
        id: withdrawalRef.id,
        telegramId: String(telegramId),
        address,
        points: MIN_POINTS,
        amount: MIN_POINTS / POINTS_PER_USDT,
        status: "pending",
        createdAt:
          admin.firestore.FieldValue.serverTimestamp()
      };

      transaction.set(
        withdrawalRef,
        withdrawalData
      );

      transaction.update(
        userRef,
        {
          balance:
            admin.firestore.FieldValue.increment(-MIN_POINTS),

          withdrawals:
            admin.firestore.FieldValue.increment(1),

          lastWithdrawalId:
            withdrawalRef.id,

          updatedAt:
            admin.firestore.FieldValue.serverTimestamp()
        }
      );
    });

    // Notify the user
    await sendTelegram(
      String(telegramId),
      `💸 <b>Withdrawal Request Received</b>

Amount: <b>0.10 USDT</b>
Network: <b>BEP20</b>
Address:
<code>${address}</code>

Status: ⏳ Pending

Your request has been received and will be processed.`
    );

    // Notify admin
    if (ADMIN_ID) {
      await sendTelegram(
        ADMIN_ID,
        `💰 <b>NEW WITHDRAWAL</b>

User ID: <code>${telegramId}</code>
Amount: <b>0.10 USDT</b>
Points: <b>10,000</b>
Network: <b>BEP20</b>

Address:
<code>${address}</code>

Withdrawal ID:
<code>${withdrawalData.id}</code>

Status: ⏳ Pending`
      );
    }

    return res.status(200).json({
      success: true,
      status: "pending",
      withdrawalId: withdrawalData.id,
      amount: 0.10
    });

  } catch (error) {

    console.error("WITHDRAW ERROR:", error);

    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    if (error.message === "INSUFFICIENT_POINTS") {
      return res.status(400).json({
        success: false,
        error: "You need at least 10,000 points"
      });
    }

    if (error.message === "CHANNELS_NOT_VERIFIED") {
      return res.status(403).json({
        success: false,
        error: "Join both required channels first"
      });
    }

    if (error.message === "NO_WALLET_ADDRESS") {
      return res.status(400).json({
        success: false,
        error: "No wallet address registered"
      });
    }

    return res.status(500).json({
      success: false,
      error: "Withdrawal failed"
    });
  }
}
