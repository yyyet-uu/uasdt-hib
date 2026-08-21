import {
  initializeApp,
  cert,
  getApps
} from "firebase-admin/app";

import {
  getFirestore,
  FieldValue
} from "firebase-admin/firestore";

function getFirebaseApp() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID;

  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL;

  let privateKey =
    process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId) {
    throw new Error(
      "FIREBASE_PROJECT_ID is missing"
    );
  }

  if (!clientEmail) {
    throw new Error(
      "FIREBASE_CLIENT_EMAIL is missing"
    );
  }

  if (!privateKey) {
    throw new Error(
      "FIREBASE_PRIVATE_KEY is missing"
    );
  }

  privateKey =
    privateKey
      .replace(/^["']|["']$/g, "")
      .replace(/\\n/g, "\n")
      .trim();

  if (
    !privateKey.includes(
      "-----BEGIN PRIVATE KEY-----"
    ) ||
    !privateKey.includes(
      "-----END PRIVATE KEY-----"
    )
  ) {
    throw new Error(
      "FIREBASE_PRIVATE_KEY has invalid PEM format"
    );
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey
    })
  });
}

const app = getFirebaseApp();

const db = getFirestore(app);

export {
  db,
  FieldValue
};
