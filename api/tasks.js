import { db, FieldValue } from "../lib/firebase.js";
import { validateInitData, getInitData } from "../lib/auth.js";
import { getChatMember } from "../lib/telegram.js";
import { CONFIG } from "../lib/config.js";

function memberOK(x) {
  return [
    "member",
    "administrator",
    "creator"
  ].includes(x.status);
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
    const action = req.body.action;

    if (action === "list") {
      const snap =
        await db.collection("tasks")
          .where("status", "==", "active")
          .limit(100)
          .get();

      return res.json({
        success: true,
        tasks: snap.docs.map(d => ({
          id: d.id,
          ...d.data()
        }))
      });
    }

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
        const snap =
          await tx.get(userRef);

        if (!snap.exists) {
          throw new Error("USER_NOT_FOUND");
        }

        const u = snap.data();

        const isAdmin =
          uid === String(process.env.TELEGRAM_ADMIN_ID);

        if (
          !isAdmin &&
          Number(u.balance || 0) <
            CONFIG.TASK_CREATE_COST
        ) {
          throw new Error("INSUFFICIENT_POINTS");
        }

        if (!isAdmin) {
          tx.update(userRef, {
            balance:
              FieldValue.increment(
                -CONFIG.TASK_CREATE_COST
              )
          });
        }

        tx.create(taskRef, {
          ownerId: uid,
          title: String(title).slice(0, 120),
          link: String(link).slice(0, 500),
          chatId: String(chatId),
          type,
          reward: CONFIG.TASK_REWARD,
          completions: 0,
          maxCompletions: CONFIG.TASK_LIMIT,
          status: "active",
          createdAt:
            FieldValue.serverTimestamp()
        });
      });

      return res.json({
        success: true,
        taskId: taskRef.id
      });
    }

    if (action === "complete") {
      const taskId =
        String(req.body.taskId || "");

      const taskRef =
        db.collection("tasks").doc(taskId);

      const completionRef =
        db.collection("taskCompletions")
          .doc(`${uid}_${taskId}`);

      const userRef =
        db.collection("users").doc(uid);

      let reward = 0;

      await db.runTransaction(async tx => {
        const task =
          await tx.get(taskRef);

        const completion =
          await tx.get(completionRef);

        const user =
          await tx.get(userRef);

        if (!task.exists) {
          throw new Error("TASK_NOT_FOUND");
        }

        if (!user.exists) {
          throw new Error("USER_NOT_FOUND");
        }

        if (completion.exists) {
          throw new Error("ALREADY_COMPLETED");
        }

        const t = task.data();

        if (t.status !== "active") {
          throw new Error("TASK_CLOSED");
        }

        if (
          Number(t.completions || 0) >=
          CONFIG.TASK_LIMIT
        ) {
          throw new Error("TASK_FULL");
        }

        reward = CONFIG.TASK_REWARD;

        tx.create(completionRef, {
          userId: uid,
          taskId,
          reward,
          createdAt:
            FieldValue.serverTimestamp()
        });

        const newCount =
          Number(t.completions || 0) + 1;

        tx.update(taskRef, {
          completions: newCount,
          status:
            newCount >= CONFIG.TASK_LIMIT
              ? "completed"
              : "active"
        });

        tx.update(userRef, {
          balance:
            FieldValue.increment(reward),

          tasksCompleted:
            FieldValue.increment(1)
        });
      });

      /*
       * Membership is checked BEFORE this transaction
       * so users cannot claim arbitrary rewards.
       */

      const taskData =
        (await taskRef.get()).data();

      const member =
        await getChatMember(
          taskData.chatId,
          uid
        );

      if (!memberOK(member)) {
        await completionRef.delete();

        throw new Error(
          "TELEGRAM_MEMBERSHIP_REQUIRED"
        );
      }

      return res.json({
        success: true,
        reward
      });
    }

    throw new Error("UNKNOWN_ACTION");

  } catch (error) {
    console.error(error);

    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
        }
