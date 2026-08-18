import { sendMessage } from "../lib/telegram.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const update = req.body;

    if (update?.message?.text === "/start") {
      const chatId =
        update.message.chat.id;

      const webAppUrl =
        process.env.WEBAPP_URL;

      await sendMessage(
        chatId,
        "🔥 <b>Welcome to USDT Hub!</b>\n\nEarn points from ads, tasks and referrals, then withdraw your rewards.",
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🚀 OPEN USDT HUB",
                  web_app: {
                    url: webAppUrl
                  }
                }
              ]
            ]
          }
        }
      );
    }

    return res.json({
      success: true
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false
    });
  }
}
