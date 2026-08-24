import fetch from "node-fetch";

// Uses your exact Vercel environment variable name
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export async function sendMessage(chatId, text, options = {}) {
  if (!BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN is not configured in Vercel environment variables.");
    return { success: false, error: "BOT_TOKEN_NOT_CONFIGURED" };
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "HTML",
      ...options
    })
  });

  return await response.json();
}

export async function getChatMember(chatId, userId) {
  if (!BOT_TOKEN) {
    return { status: "member" };
  }

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${userId}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.ok) return data.result;
    return { status: "left" };
  } catch {
    return { status: "member" };
  }
}

export async function broadcastPaymentProof(proof) {
  const channel = process.env.PROOF_CHANNEL_ID || "@birr_gram";
  const text = [
    `💎 <b>NEW USDT PAYOUT PROOF</b> 💎`,
    ``,
    `👤 <b>User:</b> <code>${String(proof.userId).slice(0, 4)}***</code>`,
    `💰 <b>Amount:</b> <code>${proof.amountUSDT} USDT</code>`,
    `🔗 <b>TxHash:</b> <a href="https://bscscan.com/tx/${proof.txHash}">${proof.txHash.slice(0, 10)}...</a>`,
    ``,
    `🚀 Earn free USDT instantly on USDT Hub!`
  ].join("\n");

  await sendMessage(channel, text);
}

export async function notifyNewReferral(inviterId, name) {
  await sendMessage(inviterId, `👥 <b>New Referral!</b>\n\n${name} just joined using your link. You will earn your bonus once they verify channels and watch ads!`);
}

export async function notifyReferralBonus(inviterId, reason, amount) {
  await sendMessage(inviterId, `🎁 <b>Referral Bonus Received!</b>\n\nReason: ${reason}\nReward: <b>+${amount} PTS</b>`);
}

export async function notifyWithdrawalSuccess(userId, amount, txHash) {
  await sendMessage(userId, `💸 <b>Payout Successful!</b>\n\n${amount} USDT has been sent to your wallet.\nTx: <a href="https://bscscan.com/tx/${txHash}">View Transaction</a>`);
}

export async function notifyWelcomeBonus(userId, amount, txHash) {
  await sendMessage(userId, `🎁 <b>Welcome Bonus Paid!</b>\n\nYour ${amount} USDT gift has been sent to your wallet.\nTx: <a href="https://bscscan.com/tx/${txHash}">View Transaction</a>`);
}
