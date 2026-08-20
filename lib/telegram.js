import { CONFIG } from "./config.js";

const TELEGRAM_API =
  "https://api.telegram.org/bot";

function getBotToken() {
  if (!CONFIG.BOT_TOKEN) {
    throw new Error("BOT_TOKEN_NOT_CONFIGURED");
  }

  return CONFIG.BOT_TOKEN;
}

async function telegramRequest(method, payload = {}) {
  const token = getBotToken();

  const response = await fetch(
    `${TELEGRAM_API}${token}/${method}`,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify(payload)
    }
  );

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `TELEGRAM_INVALID_RESPONSE_${response.status}`
    );
  }

  if (!response.ok || !data.ok) {
    throw new Error(
      data?.description ||
      `TELEGRAM_API_ERROR_${response.status}`
    );
  }

  return data.result;
}


// =====================================================
// GET CHAT MEMBER
// =====================================================

async function getChatMember(
  chatId,
  userId
) {
  if (!chatId) {
    throw new Error("CHAT_ID_REQUIRED");
  }

  if (!userId) {
    throw new Error("USER_ID_REQUIRED");
  }

  return await telegramRequest(
    "getChatMember",
    {
      chat_id: chatId,
      user_id: Number(userId)
    }
  );
}


// =====================================================
// SEND MESSAGE
// =====================================================

async function sendMessage(
  chatId,
  text,
  extra = {}
) {
  if (!chatId) {
    throw new Error("CHAT_ID_REQUIRED");
  }

  if (!text) {
    throw new Error("MESSAGE_TEXT_REQUIRED");
  }

  return await telegramRequest(
    "sendMessage",
    {
      chat_id: chatId,
      text: String(text),
      parse_mode: "HTML",
      ...extra
    }
  );
}


// =====================================================
// CHECK ALL REQUIRED CHANNELS
// =====================================================

async function checkAllChannels(
  userId
) {
  const results =
    await Promise.all(
      CONFIG.CHANNELS.map(
        channel =>
          getChatMember(
            channel,
            userId
          )
      )
    );

  return results.every(member => {
    const status =
      member?.status;

    if (
      status === "member" ||
      status === "administrator" ||
      status === "creator"
    ) {
      return true;
    }

    if (
      status === "restricted" &&
      member?.is_member === true
    ) {
      return true;
    }

    return false;
  });
}


export {
  getChatMember,
  sendMessage,
  checkAllChannels
};
