// config/firebase.js

import "dotenv/config";
import admin from "firebase-admin";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const bucketName = process.env.STORAGE_BUCKET;

function normalizePrivateKey(value) {
  if (!value) {
    throw new Error("FIREBASE_PRIVATE_KEY is not set");
  }

  let key = String(value).trim();

  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }

  key = key
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  if (
    !key.includes("-----BEGIN PRIVATE KEY-----") ||
    !key.includes("-----END PRIVATE KEY-----")
  ) {
    throw new Error(
      "FIREBASE_PRIVATE_KEY is not a valid PEM private key"
    );
  }

  return key;
}

if (!projectId) {
  throw new Error("FIREBASE_PROJECT_ID is not set");
}

if (!clientEmail) {
  throw new Error("FIREBASE_CLIENT_EMAIL is not set");
}

const privateKey = normalizePrivateKey(
  process.env.FIREBASE_PRIVATE_KEY
);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    ...(bucketName ? { storageBucket: bucketName } : {}),
  });
}

export const db = admin.firestore();

export const bucket = bucketName
  ? admin.storage().bucket()
  : null;

export { admin };