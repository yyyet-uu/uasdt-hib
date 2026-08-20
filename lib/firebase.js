import {
  initializeApp,
  cert,
  getApps
} from "firebase-admin/app";

import {
  getFirestore,
  FieldValue
} from "firebase-admin/firestore";

// =====================================================
// FIREBASE ADMIN INITIALIZATION
// =====================================================

function requiredEnv(name) {
  const value = process.env[name];

  if (!value || !String(value).trim()) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return String(value).trim();
}

function getPrivateKey() {
  const raw = requiredEnv("FIREBASE_PRIVATE_KEY");

  // Vercel may store the private key with literal \n characters.
  return raw.replace(/\\n/g, "\n");
}

const projectId =
  requiredEnv("FIREBASE_PROJECT_ID");

const clientEmail =
  requiredEnv("FIREBASE_CLIENT_EMAIL");

const privateKey =
  getPrivateKey();

// Reuse the Firebase app when Vercel keeps
// the serverless function warm.
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

const db =
  getFirestore(app);

export {
  db,
  FieldValue
};
