import { db, FieldValue } from "../lib/firebase.js";
import { validateInitData, getInitData } from "../lib/auth.js";

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

    if (
      String(user.id) !==
      String(process.env.TELEGRAM_ADMIN_ID)
    ) {
      return res.status(403).json({
        success: false,
        error: "Admin only"
      });
    }

    const action = req.body.action;

    if (action === "withdrawals") {
      const snap =
        await db.collection("withdrawals")
          .where("status", "==", "processing")
          .limit(100)
          .get();

      return res.json({
        success: true,
        withdrawals:
          snap.docs.map(d => ({
            id: d.id,
            ...d.data()
          }))
      });
    }

    if (action === "closeTask") {
      const taskId =
        String(req.body.taskId || "");

      if (!taskId) {
        throw new Error("TASK_ID_REQUIRED");
      }

      await db.collection("tasks")
        .doc(taskId)
        .update({
          status: "closed",
          updatedAt:
            FieldValue.serverTimestamp()
        });

      return res.json({
        success: true
      });
    }

    if (action === "stats") {
      const users =
        await db.collection("users").count().get();

      const tasks =
        await db.collection("tasks").count().get();

      return res.json({
        success: true,
        users: users.data().count,
        tasks: tasks.data().count
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
