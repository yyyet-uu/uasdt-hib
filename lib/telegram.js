import fetch from "node-fetch";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/**
 * Send a Telegram message
 */
export async function sendMessage(chatId, text, options = {}) {
  if (!BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN is not configured.");
    return {
      success: false,
      error: "BOT_TOKEN_NOT_CONFIGURED"
    };
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...options
    })
  });

  return await response.json();
}


/**
 * Check whether a Telegram user joined a channel.
 *
 * IMPORTANT:
 * We NEVER return "member" when the Telegram API fails.
 * This prevents users from bypassing the mandatory channels.
 */
export async function getChatMember(chatId, userId) {
  if (!BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN is missing.");
    return {
      status: "left"
    };
  }

  try {
    const url =
      `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember` +
      `?chat_id=${encodeURIComponent(chatId)}` +
      `&user_id=${encodeURIComponent(userId)}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.ok) {
      console.error(
        `Telegram getChatMember failed for ${chatId}:`,
        data
      );

      return {
        status: "left"
      };
    }

    return data.result;

  } catch (error) {
    console.error(
      `Telegram membership check failed for ${chatId}:`,
      error
    );

    return {
      status: "left"
    };
  }
}


/**
 * Broadcast successful payment proof
 */
export async function broadcastPaymentProof(proof) {
  const channel =
    process.env.PROOF_CHANNEL_ID ||
    "@usdt_hub_payment_proof";

  const txHash = String(proof.txHash || "");

  const text = [
    `💎 <b>NEW USDT PAYOUT PROOF</b> 💎`,
    ``,
    `👤 <b>User:</b> <code>${String(proof.userId).slice(0, 4)}***</code>`,
    `💰 <b>Amount:</b> <code>${proof.amountUSDT} USDT</code>`,
    ``,
    `🔗 <b>Transaction:</b>`,
    `<a href="https://bscscan.com/tx/${txHash}">${txHash.slice(0, 14)}...</a>`,
    ``,
    `🚀 <b>Earn USDT with USDT Hub!</b>`
  ].join("\n");

  return await sendMessage(channel, text);
}


/**
 * Notify inviter about a new referral
 */
export async function notifyNewReferral(inviterId, name) {
  return await sendMessage(
    inviterId,
    [
      `👥 <b>NEW REFERRAL!</b>`,
      ``,
      `${escapeHTML(name)} just joined using your referral link.`,
      ``,
      `🎁 You can earn referral bonuses when they complete the required actions.`
    ].join("\n")
  );
}


/**
 * Notify referral bonus
 */
export async function notifyReferralBonus(
  inviterId,
  reason,
  amount
) {
  return await sendMessage(
    inviterId,
    [
      `🎁 <b>REFERRAL BONUS RECEIVED!</b>`,
      ``,
      `📌 Reason: ${escapeHTML(reason)}`,
      `💰 Reward: <b>+${amount} PTS</b>`
    ].join("\n")
  );
}


/**
 * Notify successful withdrawal
 */
export async function notifyWithdrawalSuccess(
  userId,
  amount,
  txHash
) {
  return await sendMessage(
    userId,
    [
      `💸 <b>PAYOUT SUCCESSFUL!</b>`,
      ``,
      `<b>${amount} USDT</b> has been sent to your wallet.`,
      ``,
      `🔗 <a href="https://bscscan.com/tx/${txHash}">View Transaction</a>`
    ].join("\n")
  );
}


/**
 * Notify welcome bonus
 */
export async function notifyWelcomeBonus(
  userId,
  amount,
  txHash
) {
  return await sendMessage(
    userId,
    [
      `🎁 <b>WELCOME BONUS PAID!</b>`,
      ``,
      `Your <b>${amount} USDT</b> welcome gift has been sent to your wallet.`,
      ``,
      `🔗 <a href="https://bscscan.com/tx/${txHash}">View Transaction</a>`
    ].join("\n")
  );
}


/**
 * Escape Telegram HTML characters
 */
function escapeHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
