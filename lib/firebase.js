import admin from "firebase-admin";

function getServiceAccount() {
  // Option A: Single raw JSON string from Firebase Console
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (e) {
      console.error("FIREBASE_SERVICE_ACCOUNT JSON parse error:", e.message);
    }
  }

  // Option B: Discrete environment variables
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || "";

  if (privateKey.includes("\\n")) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  }

  if (projectId && clientEmail && privateKey) {
    return {
      projectId,
      clientEmail,
      privateKey
    };
  }

  return null;
}

if (!admin.apps.length) {
  const sa = getServiceAccount();
  if (sa) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(sa)
      });
    } catch (err) {
      console.error("Firebase Admin initializeApp failed:", err.message);
    }
  } else {
    console.error("Missing Firebase configuration in environment variables.");
  }
}

export const db = admin.apps.length ? admin.firestore() : null;
export const FieldValue = admin.apps.length ? admin.firestore.FieldValue : {
  serverTimestamp: () => new Date(),
  increment: (n) => n
};
export default admin;
