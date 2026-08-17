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

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const CHANNELS = [
  "@birr_gram",
  "@usdt_g_ram"
];

async function telegram(method, body) {
  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  return response.json();
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {

    const { telegramId } = req.body || {};

    if (!telegramId) {
      return res.status(400).json({
        success: false,
        error: "Telegram ID is required"
      });
    }

    if (!BOT_TOKEN) {
      return res.status(500).json({
        success: false,
        error: "Telegram bot is not configured"
      });
    }

    const results = [];

    for (const channel of CHANNELS) {

      const result = await telegram("getChatMember", {
        chat_id: channel,
        user_id: Number(telegramId)
      });

      const status = result?.result?.status;

      const joined =
        status === "member" ||
        status === "administrator" ||
        status === "creator";

      results.push({
        channel,
        joined
      });
    }

    const allJoined = results.every(item => item.joined);

    await db
      .collection("users")
      .doc(String(telegramId))
      .set(
        {
          channelsVerified: allJoined,
          channelStatus: results,
          updatedAt:
            admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

    return res.status(200).json({
      success: true,
      verified: allJoined,
      channels: results
    });

  } catch (error) {

    console.error("MEMBERSHIP ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Unable to verify channel membership"
    });
  }
}
