import { db, FieldValue } from "../lib/firebase.js";
import { validateInitData, getInitData } from "../lib/auth.js";
import { getChatMember } from "../lib/telegram.js";
import { CONFIG } from "../lib/config.js";

function isMember(member) {
  return [
    "member",
    "administrator",
    "creator"
  ].includes(member.status);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const { user } =
      validateInitData(getInitData(req));

    const uid = String(user.id);

    const results = await Promise.all(
      CONFIG.CHANNELS.map(channel =>
        getChatMember(channel, uid)
      )
    );

    const joined = results.every(isMember);

    if (!joined) {
      return res.json({
        success: true,
        joined: false
      });
    }

    await db.collection("users")
      .doc(uid)
      .update({
        channelsVerified: true,
        updatedAt:
          FieldValue.serverTimestamp()
      });

    return res.json({
      success: true,
      joined: true
    });

  } catch (error) {
    console.error(error);

    return res.status(400).json({
      success: false,
      joined: false,
      error: error.message
    });
  }
}
