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
const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

async function sendTelegram(chatId, text) {
  const response = await fetch(
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
    const {
      telegramId,
      message
    } = req.body || {};

    if (!telegramId || !message) {
      return res.status(400).json({
        success: false,
        error: "telegramId and message are required"
      });
    }

    if (!BOT_TOKEN) {
      return res.status(500).json({
        success: false,
        error: "Telegram bot is not configured"
      });
    }

    const result = await sendTelegram(
      String(telegramId),
      message
    );

    if (!result.ok) {
      return res.status(400).json({
        success: false,
        error: result.description || "Telegram failed"
      });
    }

    return res.status(200).json({
      success: true
    });

  } catch (error) {
    console.error("TELEGRAM ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Telegram server error"
    });
  }
}
