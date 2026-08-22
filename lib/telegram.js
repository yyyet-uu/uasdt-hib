import { CONFIG } from "./config.js";

const TELEGRAM_API = "https://api.telegram.org/bot";
const BSCSCAN_TX_URL = "https://bscscan.com/tx/";

function getBotToken() {
  if (!CONFIG.BOT_TOKEN) {
    throw new Error("BOT_TOKEN_NOT_CONFIGURED");
  }
  return CONFIG.BOT_TOKEN;
}

async function telegramRequest(method, payload = {}) {
  const token = getBotToken();

  const response = await fetch(`${TELEGRAM_API}${token}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`TELEGRAM_INVALID_RESPONSE_${response.status}`);
  }

  if (!response.ok || !data.ok) {
    throw new Error(data?.description || `TELEGRAM_API_ERROR_${response.status}`);
  }

  return data.result;
}

// =====================================================
// CHAT MEMBERSHIP VERIFICATION
// =====================================================

export async function getChatMember(chatId, userId) {
  if (!chatId) throw new Error("CHAT_ID_REQUIRED");
  if (!userId) throw new Error("USER_ID_REQUIRED");

  return await telegramRequest("getChatMember", {
    chat_id: chatId,
    user_id: Number(userId)
  });
}

export async function checkAllChannels(userId) {
  const results = await Promise.all(
    CONFIG.CHANNELS.map(channel => getChatMember(channel, userId))
  );

  return results.every(member => {
    const status = member?.status;
    return ["member", "administrator", "creator"].includes(status);
  });
}

// =====================================================
// SEND MESSAGE
// =====================================================

export async function sendMessage(chatId, text, extra = {}) {
  if (!chatId) throw new Error("CHAT_ID_REQUIRED");
  if (!text) throw new Error("MESSAGE_TEXT_REQUIRED");

  return await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: String(text),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra
  });
}

// =====================================================
// AUTOMATED PROOF BROADCAST TO @birr_gram
// =====================================================

export async function broadcastPaymentProof({ type, userId, amountUSDT, txHash, address }) {
  try {
    const maskedAddr = address
      ? `${address.slice(0, 6)}...${address.slice(-4)}`
      : "Protected";

    const title =
      type === "welcome"
        ? "🎁 <b>NEW WELCOME BONUS PAID</b>"
        : "💸 <b>NEW WITHDRAWAL SENT</b>";

    const bscUrl = `${BSCSCAN_TX_URL}${txHash}`;

    const message = [
      `💎 <b>USDT HUB — OFFICIAL PAYMENT PROOF</b>`,
      `━━━━━━━━━━━━━━━━━━━━`,
      title,
      ``,
      `👤 <b>User ID:</b> <code>${userId}</code>`,
      `💰 <b>Amount:</b> <code>${amountUSDT} USDT (BEP20)</code>`,
      `📫 <b>Destination:</b> <code>${maskedAddr}</code>`,
      `⚡ <b>Status:</b> <code>Confirmed on Blockchain (BSC)</code>`,
      `🔗 <b>Tx Hash:</b> <code>${txHash}</code>`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `🚀 Join @birr_gram & @usdt_g_ram to earn daily rewards!`
    ].join("\n");

    await sendMessage(CONFIG.PAYMENT_PROOF_CHANNEL, message, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🔎 View on BscScan",
              url: bscUrl
            },
            {
              text: "🚀 Open App & Earn",
              url: `https://t.me/${CONFIG.BOT_USERNAME}`
            }
          ]
        ]
      }
    });
  } catch (error) {
    console.error("PAYMENT PROOF BROADCAST ERROR:", error?.message || error);
  }
}

// =====================================================
// DIRECT USER NOTIFICATIONS
// =====================================================

export async function notifyNewReferral(inviterChatId, referredName) {
  try {
    await sendMessage(
      inviterChatId,
      `🎉 <b>New Referral Registered!</b>\n\nUser <b>${referredName}</b> joined using your invitation link.\n\n💰 <b>Rewards:</b>\n• +500 PTS when they join mandatory channels\n• +500 PTS when they watch 2 ads`
    );
  } catch {}
}

export async function notifyReferralBonus(inviterChatId, reason, points) {
  try {
    await sendMessage(
      inviterChatId,
      `🎁 <b>Referral Reward Earned!</b>\n\n+<b>${points} PTS</b> credited to your balance.\n📌 <i>Reason: ${reason}</i>`
    );
  } catch {}
}

export async function notifyWithdrawalSuccess(chatId, amountUSDT, txHash) {
  try {
    const bscUrl = `${BSCSCAN_TX_URL}${txHash}`;
    await sendMessage(
      chatId,
      `💸 <b>Withdrawal Successful!</b>\n\n💰 <b>${amountUSDT} USDT</b> has been transferred to your BEP20 wallet.\n\n🔗 <b>Transaction:</b>\n<code>${txHash}</code>`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔎 View on BscScan", url: bscUrl }]
          ]
        }
      }
    );
  } catch {}
}

export async function notifyWelcomeBonus(chatId, amountUSDT, txHash) {
  try {
    const bscUrl = `${BSCSCAN_TX_URL}${txHash}`;
    await sendMessage(
      chatId,
      `🎁 <b>Welcome Bonus Delivered!</b>\n\n💰 <b>${amountUSDT} USDT</b> has been transferred to your BEP20 address.\n\n🔗 <b>Transaction:</b>\n<code>${txHash}</code>`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔎 View on BscScan", url: bscUrl }]
          ]
        }
      }
    );
  } catch {}
}
