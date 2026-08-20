import {
  initializeApp,
  cert,
  getApps
} from "firebase-admin/app";

import {
  getFirestore,
  FieldValue
} from "firebase-admin/firestore";

function getPrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY;

  if (!key) {
    throw new Error(
      "FIREBASE_PRIVATE_KEY is missing"
    );
  }

  return key.replace(/\\n/g, "\n");
}

const firebaseConfig = {
  projectId:
    process.env.FIREBASE_PROJECT_ID,

  clientEmail:
    process.env.FIREBASE_CLIENT_EMAIL,

  privateKey:
    getPrivateKey()
};

const app =
  getApps().length
    ? getApps()[0]
    : initializeApp({
        credential:
          cert(firebaseConfig)
      });

const db =
  getFirestore(app);

export {
  db,
  FieldValue
};
