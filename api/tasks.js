import { db, FieldValue } from "../lib/firebase.js";
import { validateInitData, getInitData } from "../lib/auth.js";
import { getChatMember } from "../lib/telegram.js";
import { CONFIG } from "../lib/config.js";

function memberOK(member) {
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
    const action = String(req.body?.action || "");

    // =========================
    // LIST TASKS
    // =========================
    if (action === "list") {
      const snap = await db
        .collection("tasks")
        .where("status", "==", "active")
        .limit(100)
        .get();

      return res.json({
        success: true,
        tasks: snap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
      });
    }

    // =========================
    // CREATE TASK
    // =========================
    if (action === "create") {
      const {
        title,
        link,
        chatId,
        type
      } = req.body;

      if (!title || !link || !chatId) {
        throw new Error("TASK_DATA_REQUIRED");
      }

      if (!["channel", "bot"].includes(type)) {
        throw new Error("INVALID_TASK_TYPE");
      }

      const userRef =
        db.collection("users").doc(uid);

      const taskRef =
        db.collection("tasks").doc();

      await db.runTransaction(async tx => {
        const userSnap =
          await tx.get(userRef);

        if (!userSnap.exists) {
          throw new Error("USER_NOT_FOUND");
        }

        const u = userSnap.data();

        const isAdmin =
          uid === String(
            process.env.TELEGRAM_ADMIN_ID || ""
          );

        const balance =
          Number(u.balance || 0);

        if (
          !isAdmin &&
          balance < CONFIG.TASK_CREATE_COST
        ) {
          throw new Error("INSUFFICIENT_POINTS");
        }

        if (!isAdmin) {
          tx.update(userRef, {
            balance:
              FieldValue.increment(
                -CONFIG.TASK_CREATE_COST
              ),
            updatedAt:
              FieldValue.serverTimestamp()
          });
        }

        tx.create(taskRef, {
          ownerId: uid,

          title:
            String(title).slice(0, 120),

          link:
            String(link).slice(0, 500),

          chatId:
            String(chatId),

          type,

          reward:
            CONFIG.TASK_REWARD,

          completions: 0,

          maxCompletions:
            CONFIG.TASK_LIMIT,

          status: "active",

          createdAt:
            FieldValue.serverTimestamp(),

          updatedAt:
            FieldValue.serverTimestamp()
        });
      });

      return res.json({
        success: true,
        taskId: taskRef.id
      });
    }

    // =========================
    // COMPLETE TASK
    // =========================
    if (action === "complete") {
      const taskId =
        String(req.body?.taskId || "");

      if (!taskId) {
        throw new Error("TASK_ID_REQUIRED");
      }

      const taskRef =
        db.collection("tasks").doc(taskId);

      const completionRef =
        db.collection("taskCompletions")
          .doc(`${uid}_${taskId}`);

      const userRef =
        db.collection("users").doc(uid);

      // Get task first so we know where
      // the user must join.
      const taskSnap =
        await taskRef.get();

      if (!taskSnap.exists) {
        throw new Error("TASK_NOT_FOUND");
      }

      const task =
        taskSnap.data();

      if (task.status !== "active") {
        throw new Error("TASK_CLOSED");
      }

      // IMPORTANT:
      // Verify membership BEFORE giving points.
      const member =
        await getChatMember(
          task.chatId,
          uid
        );

      if (!memberOK(member)) {
        throw new Error(
          "TELEGRAM_MEMBERSHIP_REQUIRED"
        );
      }

      let reward = 0;

      await db.runTransaction(async tx => {
        const freshTask =
          await tx.get(taskRef);

        const completion =
          await tx.get(completionRef);

        const user =
          await tx.get(userRef);

        if (!freshTask.exists) {
          throw new Error("TASK_NOT_FOUND");
        }

        if (!user.exists) {
          throw new Error("USER_NOT_FOUND");
        }

        if (completion.exists) {
          throw new Error("ALREADY_COMPLETED");
        }

        const t =
          freshTask.data();

        if (t.status !== "active") {
          throw new Error("TASK_CLOSED");
        }

        const current =
          Number(t.completions || 0);

        if (current >= CONFIG.TASK_LIMIT) {
          throw new Error("TASK_FULL");
        }

        reward =
          Number(CONFIG.TASK_REWARD);

        const newCount =
          current + 1;

        tx.create(completionRef, {
          userId: uid,
          taskId,
          reward,
          createdAt:
            FieldValue.serverTimestamp()
        });

        tx.update(taskRef, {
          completions: newCount,

          status:
            newCount >= CONFIG.TASK_LIMIT
              ? "completed"
              : "active",

          updatedAt:
            FieldValue.serverTimestamp()
        });

        tx.update(userRef, {
          balance:
            FieldValue.increment(reward),

          tasksCompleted:
            FieldValue.increment(1),

          updatedAt:
            FieldValue.serverTimestamp()
        });
      });

      return res.json({
        success: true,
        reward
      });
    }

    throw new Error("UNKNOWN_ACTION");

  } catch (error) {
    console.error("TASK ERROR:", error);

    return res.status(400).json({
      success: false,
      error: error.message || "Task request failed"
    });
  }
        }
