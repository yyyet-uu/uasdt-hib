import admin from "firebase-admin";

if (!admin.apps.length) {
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (privateKey) {
      // Fixes Vercel literal string "\n" issue
      privateKey = privateKey.replace(/\\n/g, "\n");

      // Strips accidental wrapping quotes from environment paste
      if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.slice(1, -1);
      }
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey
      })
    });
  } catch (error) {
    console.error("Firebase Admin initialization error:", error);
  }
}

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;
export default admin;
