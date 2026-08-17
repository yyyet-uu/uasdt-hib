import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    })
  });
}

const db = admin.firestore();

const WELCOME_AMOUNT = 0.01;

function isValidBep20Address(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {

    const {
      telegramId,
      bep20Address
    } = req.body || {};

    if (!telegramId) {
      return res.status(400).json({
        success: false,
        error: "Telegram ID is required"
      });
    }

    if (!bep20Address) {
      return res.status(400).json({
        success: false,
        error: "BEP20 address is required"
      });
    }

    const address = bep20Address.trim().toLowerCase();

    if (!isValidBep20Address(address)) {
      return res.status(400).json({
        success: false,
        error: "Invalid BEP20 address"
      });
    }

    const userRef =
      db.collection("users").doc(String(telegramId));

    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({
        success: false,
        error: "User is not registered"
      });
    }

    const user = userSnap.data();

    if (!user.channelsVerified) {
      return res.status(403).json({
        success: false,
        error: "You must join both channels first"
      });
    }

    if (user.welcomeBonusClaimed === true) {
      return res.status(409).json({
        success: false,
        error: "Welcome bonus has already been claimed"
      });
    }

    /*
      IMPORTANT:
      We use the address as the permanent claim key.
      This prevents another Telegram account from
      claiming the welcome bonus using the same address.
    */

    const addressRef =
      db.collection("welcomeClaims").doc(address);

    const claimSnap = await addressRef.get();

    if (claimSnap.exists) {
      return res.status(409).json({
        success: false,
        error: "This address has already claimed the welcome bonus"
      });
    }

    const batch = db.batch();

    batch.set(addressRef, {
      address,
      telegramId: String(telegramId),
      amount: WELCOME_AMOUNT,
      status: "pending",
      createdAt:
        admin.firestore.FieldValue.serverTimestamp()
    });

    batch.set(
      userRef,
      {
        welcomeBonusClaimed: true,
        welcomeAddress: address,
        welcomeBonusAmount: WELCOME_AMOUNT,
        welcomeBonusStatus: "pending",
        appUnlocked: true,
        updatedAt:
          admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    await batch.commit();

    return res.status(200).json({
      success: true,
      unlocked: true,
      amount: WELCOME_AMOUNT,
      address,
      payoutStatus: "pending"
    });

  } catch (error) {

    console.error("WELCOME BONUS ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Unable to process welcome bonus"
    });
  }
}
