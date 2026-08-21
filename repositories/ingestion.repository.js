import { db, admin } from "../config/firebase.js";

export async function getIngestionState(key) {
  const ref = db
    .collection("ingestion")
    .doc(key);

  const snapshot = await ref.get();

  if (!snapshot.exists) {
    return null;
  }

  return snapshot.data();
}

export async function saveIngestionState(
  key,
  data
) {
  await db
    .collection("ingestion")
    .doc(key)
    .set(
      {
        ...data,

        updatedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      },
      {
        merge: true,
      }
    );
}