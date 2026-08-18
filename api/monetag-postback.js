import { db, FieldValue } from "../lib/firebase.js";

export default async function handler(req, res) {
  try {
    const {
      telegram_id,
      ymid,
      reward_event_type,
      zone_id
    } = req.query;

    if (!telegram_id || !ymid) {
      return res.status(400).send("missing");
    }

    if (process.env.MONETAG_POSTBACK_SECRET) {
      if (
        req.query.secret !==
        process.env.MONETAG_POSTBACK_SECRET
      ) {
        return res.status(403).send("forbidden");
      }
    }

    if (
      reward_event_type &&
      reward_event_type !== "valued"
    ) {
      return res.status(200).send("ignored");
    }

    const eventId =
      `monetag_${ymid}_${zone_id || "default"}`;

    const eventRef =
      db.collection("monetagEvents").doc(eventId);

    const userRef =
      db.collection("users")
        .doc(String(telegram_id));

    await db.runTransaction(async tx => {
      const old =
        await tx.get(eventRef);

      if (old.exists) return;

      const user =
        await tx.get(userRef);

      if (!user.exists) {
        throw new Error("USER_NOT_FOUND");
      }

      tx.create(eventRef, {
        userId: String(telegram_id),
        ymid,
        zoneId: zone_id || null,
        createdAt:
          FieldValue.serverTimestamp()
      });

      tx.update(userRef, {
        balance:
          FieldValue.increment(75),

        adsWatched:
          FieldValue.increment(1),

        monetagAds:
          FieldValue.increment(1),

        updatedAt:
          FieldValue.serverTimestamp()
      });
    });

    return res.status(200).send("ok");

  } catch (error) {
    console.error(error);
    return res.status(400).send("error");
  }
                }
