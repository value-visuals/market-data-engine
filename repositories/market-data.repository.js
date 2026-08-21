// repositories/market-data.repository.js

import { admin, db } from "../config/firebase.js";

/**
 * Firestore layout
 *
 * marketData/
 *   crypto/
 *     BTC/
 *       candles/
 *         {timestamp}
 *
 *   metals/
 *     XAU/
 *       candles/
 *         {timestamp}
 *
 * The timestamp is stored as the document ID so that the same
 * candle can safely be written again without creating duplicates.
 */

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------

function timestampToDocId(timestamp) {
  const value =
    timestamp instanceof Date
      ? timestamp.getTime()
      : Number(timestamp);

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid candle timestamp: ${timestamp}`);
  }

  return String(Math.floor(value));
}

function normalizeCandle(candle) {
  if (!candle || typeof candle !== "object") {
    throw new Error("Invalid candle");
  }

  const timestamp =
    candle.t ??
    candle.timestamp ??
    candle.time;

  const timestampMs =
    typeof timestamp === "string" && !/^\d+$/.test(timestamp)
      ? new Date(timestamp).getTime()
      : Number(timestamp);

  if (!Number.isFinite(timestampMs)) {
    throw new Error(
      `Invalid candle timestamp: ${timestamp}`
    );
  }

  return {
    t: Math.floor(timestampMs),
    o: candle.o != null ? Number(candle.o) : null,
    h: candle.h != null ? Number(candle.h) : null,
    l: candle.l != null ? Number(candle.l) : null,
    c: candle.c != null ? Number(candle.c) : null,

    ...(candle.v != null
      ? { v: Number(candle.v) }
      : candle.volume != null
        ? { v: Number(candle.volume) }
        : {}),
  };
}

function assertValidSymbol(symbol) {
  if (!symbol || typeof symbol !== "string") {
    throw new Error("A symbol is required");
  }

  return symbol.trim().toUpperCase();
}

function assertValidInterval(interval) {
  if (!interval || typeof interval !== "string") {
    throw new Error("An interval is required");
  }

  return interval.trim();
}

// ---------------------------------------------------------
// Crypto candles
// ---------------------------------------------------------

export async function saveCryptoCandles({
  symbol,
  interval,
  candles,
  provider = null,
  currency = "USD",
}) {
  const normalizedSymbol = assertValidSymbol(symbol);
  const normalizedInterval = assertValidInterval(interval);

  if (!Array.isArray(candles) || candles.length === 0) {
    return {
      saved: 0,
      symbol: normalizedSymbol,
      interval: normalizedInterval,
    };
  }

  const collectionRef = db
    .collection("marketData")
    .doc("crypto")
    .collection(normalizedSymbol)
    .doc("candles")
    .collection(normalizedInterval);

  let saved = 0;

  // Firestore batch writes are limited to 500 operations.
  for (let i = 0; i < candles.length; i += 500) {
    const chunk = candles.slice(i, i + 500);
    const batch = db.batch();

    for (const rawCandle of chunk) {
      const candle = normalizeCandle(rawCandle);
      const docId = timestampToDocId(candle.t);

      const ref = collectionRef.doc(docId);

      batch.set(
        ref,
        {
          ...candle,
          symbol: normalizedSymbol,
          interval: normalizedInterval,
          currency: String(currency).toUpperCase(),
          provider,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    await batch.commit();
    saved += chunk.length;
  }

  return {
    saved,
    symbol: normalizedSymbol,
    interval: normalizedInterval,
  };
}

// ---------------------------------------------------------
// Metals candles
// ---------------------------------------------------------

export async function saveMetalCandles({
  symbol,
  interval,
  candles,
  provider = "api-ninjas",
  currency = "USD",
}) {
  const normalizedSymbol = assertValidSymbol(symbol);
  const normalizedInterval = assertValidInterval(interval);

  if (!Array.isArray(candles) || candles.length === 0) {
    return {
      saved: 0,
      symbol: normalizedSymbol,
      interval: normalizedInterval,
    };
  }

  const collectionRef = db
    .collection("marketData")
    .doc("metals")
    .collection(normalizedSymbol)
    .doc("candles")
    .collection(normalizedInterval);

  let saved = 0;

  for (let i = 0; i < candles.length; i += 500) {
    const chunk = candles.slice(i, i + 500);
    const batch = db.batch();

    for (const rawCandle of chunk) {
      const candle = normalizeCandle(rawCandle);
      const docId = timestampToDocId(candle.t);

      const ref = collectionRef.doc(docId);

      batch.set(
        ref,
        {
          ...candle,
          symbol: normalizedSymbol,
          interval: normalizedInterval,
          currency: String(currency).toUpperCase(),
          provider,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    await batch.commit();
    saved += chunk.length;
  }

  return {
    saved,
    symbol: normalizedSymbol,
    interval: normalizedInterval,
  };
}

// ---------------------------------------------------------
// Optional metadata helpers
// ---------------------------------------------------------

export async function saveCryptoIngestionRun({
  symbol,
  interval,
  startMs,
  endMs,
  provider,
  candleCount,
}) {
  const ref = db
    .collection("marketData")
    .doc("crypto")
    .collection("ingestionRuns")
    .doc();

  await ref.set({
    symbol: String(symbol).toUpperCase(),
    interval,
    startMs,
    endMs,
    provider,
    candleCount,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return ref.id;
}

export async function saveMetalIngestionRun({
  symbol,
  interval,
  startMs,
  endMs,
  provider,
  candleCount,
}) {
  const ref = db
    .collection("marketData")
    .doc("metals")
    .collection("ingestionRuns")
    .doc();

  await ref.set({
    symbol: String(symbol).toUpperCase(),
    interval,
    startMs,
    endMs,
    provider,
    candleCount,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return ref.id;
}