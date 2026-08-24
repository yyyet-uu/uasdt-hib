import admin from "firebase-admin";

function parseCredentials() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (e) {
      console.error("FIREBASE_SERVICE_ACCOUNT parse error:", e.message);
    }
  }

  let privateKey = process.env.FIREBASE_PRIVATE_KEY || "";
  if (privateKey.includes("\\n")) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }

  return null;
}

if (!admin.apps.length) {
  const creds = parseCredentials();
  if (creds) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(creds)
      });
    } catch (err) {
      console.error("Firebase init failed:", err.message);
    }
  }
}

export const db = admin.apps.length ? admin.firestore() : null;
export const FieldValue = admin.firestore ? admin.firestore.FieldValue : {
  serverTimestamp: () => new Date(),
  increment: (n) => n
};
export default admin;
