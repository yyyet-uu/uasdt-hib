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

const CREATE_COST = 100000;
const TASK_REWARD = 2000;
const MAX_COMPLETIONS = 50;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const {
      action,
      telegramId,
      taskId,
      type,
      title,
      link
    } = req.body || {};

    if (!telegramId) {
      return res.status(400).json({
        success: false,
        error: "Telegram ID is required"
      });
    }

    /* =========================
       GET AVAILABLE TASKS
    ========================= */

    if (action === "list") {
      const snapshot = await db
        .collection("tasks")
        .where("status", "==", "active")
        .get();

      const tasks = snapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        .filter(task =>
          Number(task.completions || 0) <
          MAX_COMPLETIONS
        );

      return res.status(200).json({
        success: true,
        tasks
      });
    }

    /* =========================
       CREATE TASK
    ========================= */

    if (action === "create") {

      if (!title || !link || !type) {
        return res.status(400).json({
          success: false,
          error: "Title, link and type are required"
        });
      }

      if (!["channel", "bot"].includes(type)) {
        return res.status(400).json({
          success: false,
          error: "Invalid task type"
        });
      }

      const userRef = db
        .collection("users")
        .doc(String(telegramId));

      let createdTask;

      await db.runTransaction(async transaction => {

        const userSnap =
          await transaction.get(userRef);

        if (!userSnap.exists) {
          throw new Error("USER_NOT_FOUND");
        }

        const user = userSnap.data();
        const balance = Number(user.balance || 0);

        if (balance < CREATE_COST) {
          throw new Error("INSUFFICIENT_POINTS");
        }

        const taskRef =
          db.collection("tasks").doc();

        createdTask = {
          id: taskRef.id,
          ownerId: String(telegramId),
          title: String(title).trim(),
          link: String(link).trim(),
          type,
          reward: TASK_REWARD,
          maxCompletions: MAX_COMPLETIONS,
          completions: 0,
          status: "active",
          createdAt:
            admin.firestore.FieldValue.serverTimestamp()
        };

        transaction.update(userRef, {
          balance:
            admin.firestore.FieldValue.increment(
              -CREATE_COST
            ),
          updatedAt:
            admin.firestore.FieldValue.serverTimestamp()
        });

        transaction.set(taskRef, createdTask);
      });

      return res.status(200).json({
        success: true,
        task: createdTask
      });
    }

    /* =========================
       COMPLETE TASK
    ========================= */

    if (action === "complete") {

      if (!taskId) {
        return res.status(400).json({
          success: false,
          error: "Task ID is required"
        });
      }

      const taskRef =
        db.collection("tasks").doc(String(taskId));

      const userRef =
        db.collection("users").doc(String(telegramId));

      const completionRef =
        db.collection("taskCompletions")
          .doc(`${telegramId}_${taskId}`);

      let rewardResult;

      await db.runTransaction(async transaction => {

        const taskSnap =
          await transaction.get(taskRef);

        const userSnap =
          await transaction.get(userRef);

        const completionSnap =
          await transaction.get(completionRef);

        if (!taskSnap.exists) {
          throw new Error("TASK_NOT_FOUND");
        }

        if (!userSnap.exists) {
          throw new Error("USER_NOT_FOUND");
        }

        if (completionSnap.exists) {
          throw new Error("ALREADY_COMPLETED");
        }

        const task = taskSnap.data();

        if (task.status !== "active") {
          throw new Error("TASK_CLOSED");
        }

        const completions =
          Number(task.completions || 0);

        if (completions >= MAX_COMPLETIONS) {
          throw new Error("TASK_FULL");
        }

        transaction.set(completionRef, {
          telegramId: String(telegramId),
          taskId: String(taskId),
          reward: TASK_REWARD,
          createdAt:
            admin.firestore.FieldValue.serverTimestamp()
        });

        const newCompletions =
          completions + 1;

        transaction.update(taskRef, {
          completions: newCompletions,

          status:
            newCompletions >= MAX_COMPLETIONS
              ? "completed"
              : "active",

          updatedAt:
            admin.firestore.FieldValue.serverTimestamp()
        });

        transaction.update(userRef, {
          balance:
            admin.firestore.FieldValue.increment(
              TASK_REWARD
            ),

          tasksCompleted:
            admin.firestore.FieldValue.increment(1),

          updatedAt:
            admin.firestore.FieldValue.serverTimestamp()
        });

        rewardResult = {
          reward: TASK_REWARD,
          completions: newCompletions,
          remaining:
            MAX_COMPLETIONS - newCompletions
        };
      });

      return res.status(200).json({
        success: true,
        ...rewardResult
      });
    }

    return res.status(400).json({
      success: false,
      error: "Unknown task action"
    });

  } catch (error) {

    console.error("TASK ERROR:", error);

    const errors = {
      USER_NOT_FOUND: [404, "User not found"],
      INSUFFICIENT_POINTS: [400, "You need 100,000 points to create a task"],
      TASK_NOT_FOUND: [404, "Task not found"],
      ALREADY_COMPLETED: [409, "You already completed this task"],
      TASK_CLOSED: [400, "This task is closed"],
      TASK_FULL: [400, "This task already has 50 completions"]
    };

    if (errors[error.message]) {
      const [status, message] = errors[error.message];

      return res.status(status).json({
        success: false,
        error: message
      });
    }

    return res.status(500).json({
      success: false,
      error: "Task operation failed"
    });
  }
                }
