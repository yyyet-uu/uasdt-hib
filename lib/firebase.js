import admin from "firebase-admin";

function getServiceAccount() {
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

export function getDb() {
  try {
    if (!admin.apps.length) {
      const sa = getServiceAccount();
      if (sa) {
        admin.initializeApp({
          credential: admin.credential.cert(sa)
        });
      } else {
        return null;
      }
    }
    return admin.firestore();
  } catch (err) {
    console.error("Firebase init error:", err.message);
    return null;
  }
}

export const FieldValue = admin.firestore ? admin.firestore.FieldValue : {
  serverTimestamp: () => new Date(),
  increment: (n) => n
};

export default admin;
