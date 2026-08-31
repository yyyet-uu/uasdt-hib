import admin from "firebase-admin";

let firebaseApp;
let firestore;

function getFirebaseApp() {
  if (firebaseApp) {
    return firebaseApp;
  }

  // Reuse an already initialized Firebase app
  if (admin.apps.length > 0) {
    firebaseApp = admin.apps[0];
    return firebaseApp;
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID;

  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL;

  let privateKey =
    process.env.FIREBASE_PRIVATE_KEY || "";

  // Handle Vercel environment variable containing literal \n
  privateKey = privateKey.replace(/\\n/g, "\n");

  // Handle accidental surrounding quotes
  if (
    privateKey.startsWith('"') &&
    privateKey.endsWith('"')
  ) {
    privateKey =
      privateKey.slice(1, -1);
  }

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

  try {
    firebaseApp =
      admin.initializeApp({
        credential:
          admin.credential.cert({
            projectId,
            clientEmail,
            privateKey
          })
      });

    return firebaseApp;

  } catch (error) {
    console.error(
      "Firebase initialization failed:",
      error
    );

    throw new Error(
      `Firebase initialization failed: ${
        error?.message || String(error)
      }`
    );
  }
}

function getFirestore() {
  if (firestore) {
    return firestore;
  }

  const app = getFirebaseApp();

  firestore =
    admin.firestore(app);

  return firestore;
}

// Initialize once
const app = getFirebaseApp();

export const db =
  getFirestore();

export const FieldValue =
  admin.firestore.FieldValue;

export default app;
