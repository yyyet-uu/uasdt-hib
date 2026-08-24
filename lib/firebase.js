import admin from "firebase-admin";

if (!admin.apps.length) {
  try {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY || "";

    // Handle escaped newlines from Vercel env variables
    if (privateKey.includes("\\n")) {
      privateKey = privateKey.replace(/\\n/g, "\n");
    }

    // Remove wrapping quotes if present
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.slice(1, -1);
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey
      })
    });
  } catch (error) {
    console.error("Firebase Admin Initialization Error:", error);
  }
}

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;
export default admin;
