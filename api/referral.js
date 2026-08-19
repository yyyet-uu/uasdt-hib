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
    const action =
      String(req.body?.action || "");

    // =========================
    // REFERRAL LIST
    // =========================
    if (action === "list") {
      const snap = await db
        .collection("referrals")
        .where("inviterId", "==", uid)
        .get();

      return res.json({
        success: true,
        referrals: snap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
      });
    }

    // =========================
    // CHECK REFERRAL REWARDS
    // =========================
    if (action === "check") {
      const snap = await db
        .collection("referrals")
        .where("referredUserId", "==", uid)
        .limit(1)
        .get();

      if (snap.empty) {
        return res.json({
          success: true
        });
      }

      const refDoc = snap.docs[0];
      const refId = refDoc.id;

      await db.runTransaction(async tx => {
        const refSnap =
          await tx.get(
            db.collection("referrals").doc(refId)
          );

        if (!refSnap.exists) {
          throw new Error("REFERRAL_NOT_FOUND");
        }

        const ref = refSnap.data();

        const referredRef =
          db.collection("users").doc(uid);

        const inviterRef =
          db.collection("users")
            .doc(String(ref.inviterId));

        const referredSnap =
          await tx.get(referredRef);

        const inviterSnap =
          await tx.get(inviterRef);

        if (!referredSnap.exists) {
          throw new Error("USER_NOT_FOUND");
        }

        if (!inviterSnap.exists) {
          throw new Error("INVITER_NOT_FOUND");
        }

        const u = referredSnap.data();

        const updates = {};

        // =========================
        // 500 POINT CHANNEL REWARD
        // =========================
        if (
          u.channelsVerified &&
          !ref.channelRewarded
        ) {
          updates.channelRewarded = true;

          tx.update(inviterRef, {
            balance:
              FieldValue.increment(
                CONFIG.REFERRAL_CHANNEL
              ),

            referralPoints:
              FieldValue.increment(
                CONFIG.REFERRAL_CHANNEL
              ),

            updatedAt:
              FieldValue.serverTimestamp()
          });
        }

        // =========================
        // 500 POINT ADS REWARD
        // =========================
        if (
          Number(u.adsWatched || 0) >= 2 &&
          !ref.adsRewarded
        ) {
          updates.adsRewarded = true;

          tx.update(inviterRef, {
            balance:
              FieldValue.increment(
                CONFIG.REFERRAL_ADS
              ),

            referralPoints:
              FieldValue.increment(
                CONFIG.REFERRAL_ADS
              ),

            updatedAt:
              FieldValue.serverTimestamp()
          });
        }

        if (Object.keys(updates).length) {
          tx.update(
            db.collection("referrals").doc(refId),
            updates
          );
        }
      });

      return res.json({
        success: true
      });
    }

    throw new Error("UNKNOWN_ACTION");

  } catch (error) {
    console.error(
      "REFERRAL ERROR:",
      error
    );

    return res.status(400).json({
      success: false,
      error:
        error.message ||
        "Referral request failed"
    });
  }
            }
