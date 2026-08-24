import admin from "firebase-admin";

if (!admin.apps.length) {
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error("Missing one or more required Firebase environment variables.");
    }

    // 1. Strip accidental surrounding quotes FIRST
    if (
      (privateKey.startsWith('"') && privateKey.endsWith('"')) ||
      (privateKey.startsWith("'") && privateKey.endsWith("'"))
    ) {
      privateKey = privateKey.slice(1, -1);
    }

    // 2. Replace escaped newlines with actual newlines SECOND
    privateKey = privateKey.replace(/\\n/g, "\n");

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  } catch (error) {
    console.error("Firebase Admin initialization error:", error.message);
  }
}

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;
export default admin;
