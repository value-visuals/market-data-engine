// repositories/market-data.repository.js

import { db } from "../config/firebase.js";

const MARKET_DATA_COLLECTION = "marketData";
const CANDLES_COLLECTION = "candles";

const MAX_BATCH_SIZE = 500;

/**
 * Build a deterministic document ID.
 *
 * Example:
 * BTC + 1787344080000
 * -> BTC_1787344080000
 */
function candleDocumentId(symbol, timestamp) {
  const normalizedSymbol = String(symbol)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "_");

  return `${normalizedSymbol}_${timestamp}`;
}

/**
 * Normalize a candle timestamp into milliseconds.
 *
 * Supports:
 *   - Date objects
 *   - Unix seconds
 *   - Unix milliseconds
 *   - ISO date strings
 */
function normalizeTimestamp(value) {
  if (value instanceof Date) {
    const timestamp = value.getTime();

    if (!Number.isFinite(timestamp)) {
      throw new Error(`Invalid candle timestamp: ${value}`);
    }

    return timestamp;
  }

  // Support ISO date strings such as:
  // 2026-08-14T00:00:00.000Z
  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      throw new Error(`Invalid candle timestamp: ${value}`);
    }

    // Numeric strings should still be treated as Unix timestamps.
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);

      if (!Number.isFinite(numeric)) {
        throw new Error(`Invalid candle timestamp: ${value}`);
      }

      return numeric < 1_000_000_000_000
        ? numeric * 1000
        : numeric;
    }

    const parsed = Date.parse(trimmed);

    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid candle timestamp: ${value}`);
    }

    return parsed;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid candle timestamp: ${value}`);
  }

  // Treat values below 1e12 as Unix seconds.
  return numeric < 1_000_000_000_000
    ? numeric * 1000
    : numeric;
}

/**
 * Return the candles collection for a symbol.
 */
function candlesCollection(symbol) {
  return db
    .collection(MARKET_DATA_COLLECTION)
    .doc(String(symbol).toUpperCase())
    .collection(CANDLES_COLLECTION);
}

/**
 * Save candles.
 *
 * IMPORTANT:
 *
 * We intentionally do NOT read every existing document before writing.
 *
 * The ingestion layer determines what data is new by looking at the
 * latest stored timestamp.
 *
 * Deterministic document IDs make this operation idempotent.
 */
export async function saveCandles(symbol, candles) {
  if (!symbol) {
    throw new Error("saveCandles requires a symbol");
  }

  if (!Array.isArray(candles)) {
    throw new Error("saveCandles requires an array of candles");
  }

  if (candles.length === 0) {
    return {
      written: 0,
      total: 0,
    };
  }

  const collection = candlesCollection(symbol);

  const uniqueCandles = new Map();

  for (const candle of candles) {
    if (!candle) {
      continue;
    }

    const timestamp = normalizeTimestamp(
      candle.timestamp ??
        candle.time ??
        candle.t
    );

    uniqueCandles.set(timestamp, {
      ...candle,
      timestamp,
    });
  }

  const normalizedCandles = Array.from(
    uniqueCandles.values()
  ).sort(
    (a, b) => a.timestamp - b.timestamp
  );

  let written = 0;

  for (
    let batchStart = 0;
    batchStart < normalizedCandles.length;
    batchStart += MAX_BATCH_SIZE
  ) {
    const batchCandles = normalizedCandles.slice(
      batchStart,
      batchStart + MAX_BATCH_SIZE
    );

    const batch = db.batch();

    for (const candle of batchCandles) {
      const id = candleDocumentId(
        symbol,
        candle.timestamp
      );

      const ref = collection.doc(id);

      batch.set(
        ref,
        {
          ...candle,
          symbol: String(symbol).toUpperCase(),
          timestamp: candle.timestamp,
          updatedAt: new Date().toISOString(),
        },
        {
          merge: false,
        }
      );

      written += 1;
    }

    await batch.commit();
  }

  return {
    written,
    total: normalizedCandles.length,
  };
}

/**
 * Get the most recent candle.
 *
 * This is intentionally ONE Firestore read.
 *
 * Normal ingestion uses this to determine where to resume.
 */
export async function getLatestCandle(symbol) {
  const collection = candlesCollection(symbol);

  const snapshot = await collection
    .orderBy("timestamp", "desc")
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];

  return {
    id: doc.id,
    ...doc.data(),
  };
}

/**
 * Get the oldest candle.
 *
 * Used only when determining whether historical backfill
 * is required.
 */
export async function getEarliestCandle(symbol) {
  const collection = candlesCollection(symbol);

  const snapshot = await collection
    .orderBy("timestamp", "asc")
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];

  return {
    id: doc.id,
    ...doc.data(),
  };
}

/**
 * Return the stored time bounds for an asset.
 *
 * This performs two Firestore reads:
 *
 *   1. oldest candle
 *   2. newest candle
 *
 * This is used only during startup/backfill decisions.
 */
export async function getCandleBounds(symbol) {
  const [earliest, latest] = await Promise.all([
    getEarliestCandle(symbol),
    getLatestCandle(symbol),
  ]);

  return {
    earliest,
    latest,
  };
}

/**
 * Read candles within a time range.
 */
export async function getCandles(
  symbol,
  startTimestamp,
  endTimestamp
) {
  const collection = candlesCollection(symbol);

  const start = normalizeTimestamp(startTimestamp);
  const end = normalizeTimestamp(endTimestamp);

  const snapshot = await collection
    .where("timestamp", ">=", start)
    .where("timestamp", "<=", end)
    .orderBy("timestamp", "asc")
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}