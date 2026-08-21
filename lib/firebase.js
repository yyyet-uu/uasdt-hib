import {
  initializeApp,
  cert,
  getApps
} from "firebase-admin/app";

import {
  getFirestore,
  FieldValue
} from "firebase-admin/firestore";

let db;
let firebaseInitialized = false;

function initializeFirebase() {
  if (firebaseInitialized) {
    return;
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID;

  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL;

  let privateKey =
    process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId) {
    throw new Error(
      "Missing FIREBASE_PROJECT_ID"
    );
  }

  if (!clientEmail) {
    throw new Error(
      "Missing FIREBASE_CLIENT_EMAIL"
    );
  }

  if (!privateKey) {
    throw new Error(
      "Missing FIREBASE_PRIVATE_KEY"
    );
  }

  // Supports both:
  // -----BEGIN PRIVATE KEY-----\n...
  // and actual multiline keys.
  privateKey =
    privateKey.replace(/\\n/g, "\n");

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

  firebaseInitialized = true;
}

initializeFirebase();

export {
  db,
  FieldValue
};
