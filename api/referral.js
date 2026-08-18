import { db, FieldValue } from "../lib/firebase.js";
import { validateInitData, getInitData } from "../lib/auth.js";
import { CONFIG } from "../lib/config.js";

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

    if (req.body.action === "list") {
      const snap =
        await db.collection("referrals")
          .where("inviterId", "==", uid)
          .get();

      return res.json({
        success: true,
        referrals: snap.docs.map(d => ({
          id: d.id,
          ...d.data()
        }))
      });
    }

    if (req.body.action === "check") {
      const snap =
        await db.collection("referrals")
          .where("referredUserId", "==", uid)
          .limit(1)
          .get();

      if (snap.empty) {
        return res.json({
          success: true
        });
      }

      const refDoc = snap.docs[0];
      const ref = refDoc.data();

      const referred =
        await db.collection("users")
          .doc(uid)
          .get();

      if (!referred.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      const u = referred.data();

      const updates = {};

      if (
        u.channelsVerified &&
        !ref.channelRewarded
      ) {
        updates.channelRewarded = true;

        await db.collection("users")
          .doc(ref.inviterId)
          .update({
            balance:
              FieldValue.increment(
                CONFIG.REFERRAL_CHANNEL
              ),
            referralPoints:
              FieldValue.increment(
                CONFIG.REFERRAL_CHANNEL
              )
          });
      }

      if (
        Number(u.adsWatched || 0) >= 2 &&
        !ref.adsRewarded
      ) {
        updates.adsRewarded = true;

        await db.collection("users")
          .doc(ref.inviterId)
          .update({
            balance:
              FieldValue.increment(
                CONFIG.REFERRAL_ADS
              ),
            referralPoints:
              FieldValue.increment(
                CONFIG.REFERRAL_ADS
              )
          });
      }

      if (Object.keys(updates).length) {
        await refDoc.ref.update(updates);
      }

      return res.json({
        success: true
      });
    }

    throw new Error("UNKNOWN_ACTION");

  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
          }
