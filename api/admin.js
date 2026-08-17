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

const ADMIN_ID = String(process.env.TELEGRAM_ADMIN_ID || "");

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
      action,
      withdrawalId,
      taskId,
      status
    } = req.body || {};

    if (!telegramId || String(telegramId) !== ADMIN_ID) {
      return res.status(403).json({
        success: false,
        error: "Admin access required"
      });
    }

    /* =========================
       LIST PENDING WITHDRAWALS
    ========================= */

    if (action === "withdrawals") {
      const snapshot = await db
        .collection("withdrawals")
        .where("status", "==", "pending")
        .get();

      const withdrawals = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      return res.status(200).json({
        success: true,
        withdrawals
      });
    }

    /* =========================
       UPDATE WITHDRAWAL STATUS
    ========================= */

    if (action === "withdrawalStatus") {
      if (!withdrawalId) {
        return res.status(400).json({
          success: false,
          error: "Withdrawal ID required"
        });
      }

      const allowed = [
        "pending",
        "processing",
        "paid",
        "rejected"
      ];

      if (!allowed.includes(status)) {
        return res.status(400).json({
          success: false,
          error: "Invalid status"
        });
      }

      const withdrawalRef = db
        .collection("withdrawals")
        .doc(String(withdrawalId));

      const snap = await withdrawalRef.get();

      if (!snap.exists) {
        return res.status(404).json({
          success: false,
          error: "Withdrawal not found"
        });
      }

      await withdrawalRef.update({
        status,
        updatedAt:
          admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(200).json({
        success: true,
        status
      });
    }

    /* =========================
       LIST TASKS
    ========================= */

    if (action === "tasks") {
      const snapshot = await db
        .collection("tasks")
        .get();

      const tasks = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      return res.status(200).json({
        success: true,
        tasks
      });
    }

    /* =========================
       CLOSE TASK
    ========================= */

    if (action === "closeTask") {
      if (!taskId) {
        return res.status(400).json({
          success: false,
          error: "Task ID required"
        });
      }

      const taskRef = db
        .collection("tasks")
        .doc(String(taskId));

      const snap = await taskRef.get();

      if (!snap.exists) {
        return res.status(404).json({
          success: false,
          error: "Task not found"
        });
      }

      await taskRef.update({
        status: "closed",
        updatedAt:
          admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(200).json({
        success: true,
        message: "Task closed"
      });
    }

    return res.status(400).json({
      success: false,
      error: "Unknown admin action"
    });

  } catch (error) {
    console.error("ADMIN ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Admin operation failed"
    });
  }
}
