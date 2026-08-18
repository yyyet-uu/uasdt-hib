const API = () =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function telegram(method, body) {
  const response = await fetch(`${API()}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.description || "Telegram API error");
  }

  return data.result;
}

export function sendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra
  });
}

export function getChatMember(chatId, userId) {
  return telegram("getChatMember", {
    chat_id: chatId,
    user_id: Number(userId)
  });
}

export function setWebhook(url) {
  return telegram("setWebhook", {
    url
  });
}
