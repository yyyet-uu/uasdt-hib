const API =
  "https://api.telegram.org/bot";

function token() {
  const value =
    process.env.TELEGRAM_BOT_TOKEN;

  if (!value) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN_MISSING"
    );
  }

  return value;
}

async function telegramRequest(
  method,
  body
) {
  const response =
    await fetch(
      `${API}${token()}/${method}`,
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json"
        },

        body:
          JSON.stringify(body)
      }
    );

  const data =
    await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(
      data?.description ||
      `Telegram ${method} failed`
    );
  }

  return data.result;
}

export async function getChatMember(
  chatId,
  userId
) {
  return telegramRequest(
    "getChatMember",
    {
      chat_id: chatId,
      user_id: Number(userId)
    }
  );
}

export async function sendMessage(
  chatId,
  text,
  extra = {}
) {
  return telegramRequest(
    "sendMessage",
    {
      chat_id: chatId,
      text,

      parse_mode:
        "HTML",

      disable_web_page_preview:
        true,

      ...extra
    }
  );
}

export async function setWebhook(
  url
) {
  return telegramRequest(
    "setWebhook",
    {
      url
    }
  );
}
