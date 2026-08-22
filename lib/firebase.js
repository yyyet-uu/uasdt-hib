import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

let db;
let firebaseInitialized = false;

function initializeFirebase() {
  if (firebaseInitialized && db) {
    return;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId) {
    throw new Error("Missing environment variable: FIREBASE_PROJECT_ID");
  }

  if (!clientEmail) {
    throw new Error("Missing environment variable: FIREBASE_CLIENT_EMAIL");
  }

  if (!privateKey) {
    throw new Error("Missing environment variable: FIREBASE_PRIVATE_KEY");
  }

  // Normalize single-line escaped \n newlines to actual line breaks
  privateKey = privateKey
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\n/g, "\n");

  const app =
    getApps().length > 0
      ? getApps()[0]
      : initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            privateKey
          })
        });

  db = getFirestore(app);

  // Optimize Firestore settings for low-latency serverless calls
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {}

  firebaseInitialized = true;
}

// Initialize on module load
initializeFirebase();

export { db, FieldValue };
