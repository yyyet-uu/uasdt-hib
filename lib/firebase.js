import admin from "firebase-admin";

function getCredentials() {
  // Option A: Single JSON Service Account string
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      return admin.credential.cert(sa);
    } catch (e) {
      console.error("FIREBASE_SERVICE_ACCOUNT JSON parse error:", e);
    }
  }

  // Option B: Standard discrete variables
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
    return admin.credential.cert({
      projectId,
      clientEmail,
      privateKey
    });
  }

  return null;
}

if (!admin.apps.length) {
  try {
    const cred = getCredentials();
    if (cred) {
      admin.initializeApp({ credential: cred });
    } else {
      console.error("Missing Firebase credentials.");
    }
  } catch (err) {
    console.error("Firebase initializeApp error:", err);
  }
}

export const db = admin.apps.length ? admin.firestore() : null;
export const FieldValue = admin.firestore?.FieldValue || {};
export default admin;
