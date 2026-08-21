import {
  initializeApp,
  cert,
  getApps
} from "firebase-admin/app";

import {
  getFirestore,
  FieldValue
} from "firebase-admin/firestore";

import serviceAccount from "./serviceAccountKey.json"
  with { type: "json" };

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert(serviceAccount)
      });

const db = getFirestore(app);

export {
  db,
  FieldValue
};
