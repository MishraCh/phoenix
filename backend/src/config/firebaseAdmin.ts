import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { env } from "./env.js";

let firestoreSettingsApplied = false;

function hasFirebaseEmulator() {
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
}

function createFirebaseApp(): App {
  const existingApp = getApps()[0];

  if (existingApp) {
    return existingApp;
  }

  if (hasFirebaseEmulator()) {
    return initializeApp({
      projectId: env.FIREBASE_PROJECT_ID ?? "gideon-local",
    });
  }

  if (env.NODE_ENV === "production") {
    return initializeApp();
  }

  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    return initializeApp({
      credential: cert({
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY,
        projectId: env.FIREBASE_PROJECT_ID,
      }),
      projectId: env.FIREBASE_PROJECT_ID,
    });
  }

  throw new Error(
    "Firebase Admin is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY, or use Firebase emulators.",
  );
}

export function getFirebaseAuth() {
  return getAuth(createFirebaseApp());
}

export function getFirebaseDb() {
  const db = getFirestore(createFirebaseApp());

  if (!firestoreSettingsApplied) {
    db.settings({ ignoreUndefinedProperties: true });
    firestoreSettingsApplied = true;
  }

  return db;
}
