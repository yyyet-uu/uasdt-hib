import {
  initializeApp,
  cert,
  getApps
} from "firebase-admin/app";

import {
  getFirestore,
  FieldValue
} from "firebase-admin/firestore";

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `${name} is missing from Vercel Environment Variables`
    );
  }

  return value;
}

const projectId =
  getRequiredEnv("FIREBASE_PROJECT_ID");

const clientEmail =
  getRequiredEnv("FIREBASE_CLIENT_EMAIL");

const privateKey =
  getRequiredEnv("FIREBASE_PRIVATE_KEY")
    .replace(/\\n/g, "\n");

const firebaseConfig = {
  projectId,
  clientEmail,
  privateKey
};

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert(firebaseConfig)
      });

const db = getFirestore(app);

export {
  db,
  FieldValue
};
