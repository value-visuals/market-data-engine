// repositories/market-data.repository.js

import { db } from "../config/firebase.js";

const MARKET_DATA_COLLECTION = "marketData";
const CANDLES_COLLECTION = "candles";
const DATA_COLLECTION = "data";

const MAX_BATCH_SIZE = 500;

/**
 * ============================================================================
 * SUPPORTED SERIES
 * ============================================================================
 *
 * Crypto:
 *
 *   BTC/USD
 *   BTC/EUR
 *   BTC/GBP
 *   ETH/USD
 *   ETH/EUR
 *   ETH/GBP
 *   XMR/USD
 *   XMR/EUR
 *   XMR/GBP
 *
 * Metals:
 *
 *   XAU/USD
 *   XAG/USD
 *
 * Metals deliberately remain USD/base only.
 */

export const SUPPORTED_SYMBOLS = [
  "BTC",
  "ETH",
  "XMR",
];

export const SUPPORTED_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
];

export const SUPPORTED_METAL_SYMBOLS = [
  "XAU",
  "XAG",
];

/* ============================================================================
   NORMALIZATION
   ========================================================================== */

function normalizeSymbol(symbol) {
  const normalized = String(symbol || "")
    .trim()
    .toUpperCase();

  if (!normalized) {
    throw new Error(
      "A market-data symbol is required"
    );
  }

  return normalized;
}

function normalizeCurrency(currency) {
  const normalized = String(currency || "")
    .trim()
    .toUpperCase();

  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error(
      `Invalid market-data currency: ${currency}`
    );
  }

  return normalized;
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
      throw new Error(
        `Invalid candle timestamp: ${value}`
      );
    }

    return timestamp;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      throw new Error(
        `Invalid candle timestamp: ${value}`
      );
    }

    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);

      if (!Number.isFinite(numeric)) {
        throw new Error(
          `Invalid candle timestamp: ${value}`
        );
      }

      return numeric < 1_000_000_000_000
        ? numeric * 1000
        : numeric;
    }

    const parsed = Date.parse(trimmed);

    if (!Number.isFinite(parsed)) {
      throw new Error(
        `Invalid candle timestamp: ${value}`
      );
    }

    return parsed;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    throw new Error(
      `Invalid candle timestamp: ${value}`
    );
  }

  return numeric < 1_000_000_000_000
    ? numeric * 1000
    : numeric;
}

/* ============================================================================
   FIRESTORE REFERENCES
   ========================================================================== */

/**
 * Crypto:
 *
 * marketData/{SYMBOL}/candles/{CURRENCY}/data
 */
function cryptoCandlesCollection(
  symbol,
  currency
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  const normalizedCurrency =
    normalizeCurrency(currency);

  return db
    .collection(MARKET_DATA_COLLECTION)
    .doc(normalizedSymbol)
    .collection(CANDLES_COLLECTION)
    .doc(normalizedCurrency)
    .collection(DATA_COLLECTION);
}

/**
 * Metals:
 *
 * marketData/{SYMBOL}/candles/USD/data
 *
 * Metals intentionally use USD/base only.
 */
function metalCandlesCollection(symbol) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  return db
    .collection(MARKET_DATA_COLLECTION)
    .doc(normalizedSymbol)
    .collection(CANDLES_COLLECTION)
    .doc("USD")
    .collection(DATA_COLLECTION);
}

/* ============================================================================
   DOCUMENT IDS
   ========================================================================== */

/**
 * Crypto:
 *
 * BTC_GBP_1787344080000
 */
function cryptoCandleDocumentId(
  symbol,
  currency,
  timestamp
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  const normalizedCurrency =
    normalizeCurrency(currency);

  return (
    `${normalizedSymbol}_` +
    `${normalizedCurrency}_` +
    `${timestamp}`
  );
}

/**
 * Metals:
 *
 * XAU_USD_1787344080000
 */
function metalCandleDocumentId(
  symbol,
  timestamp
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  return (
    `${normalizedSymbol}_USD_` +
    `${timestamp}`
  );
}

/* ============================================================================
   CANDLE NORMALIZATION
   ========================================================================== */

function normalizeCryptoCandles(
  symbol,
  currency,
  candles
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  const normalizedCurrency =
    normalizeCurrency(currency);

  const uniqueCandles = new Map();

  for (const candle of candles) {
    if (!candle) {
      continue;
    }

    const timestamp =
      normalizeTimestamp(
        candle.timestamp ??
          candle.time ??
          candle.t
      );

    uniqueCandles.set(
      timestamp,
      {
        ...candle,
        symbol: normalizedSymbol,
        currency: normalizedCurrency,
        timestamp,
      }
    );
  }

  return Array.from(
    uniqueCandles.values()
  ).sort(
    (a, b) =>
      a.timestamp - b.timestamp
  );
}

function normalizeMetalCandles(
  symbol,
  candles
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  const uniqueCandles = new Map();

  for (const candle of candles) {
    if (!candle) {
      continue;
    }

    const timestamp =
      normalizeTimestamp(
        candle.timestamp ??
          candle.time ??
          candle.t
      );

    uniqueCandles.set(
      timestamp,
      {
        ...candle,
        symbol: normalizedSymbol,
        currency: "USD",
        timestamp,
      }
    );
  }

  return Array.from(
    uniqueCandles.values()
  ).sort(
    (a, b) =>
      a.timestamp - b.timestamp
  );
}

/* ============================================================================
   SAVE CANDLES
   ========================================================================== */

/**
 * Save candles.
 *
 * Supports BOTH existing call signatures:
 *
 * Crypto:
 *
 *   saveCandles(symbol, currency, candles)
 *
 * Metals:
 *
 *   saveCandles(symbol, candles)
 *
 * This preserves compatibility with the existing jobs.
 */
export async function saveCandles(
  symbol,
  currencyOrCandles,
  maybeCandles
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  let currency;
  let candles;
  let isMetalStyleCall = false;

  /**
   * Metals:
   *
   * saveCandles("XAU", candles)
   */
  if (
    Array.isArray(currencyOrCandles) &&
    maybeCandles === undefined
  ) {
    currency = "USD";
    candles = currencyOrCandles;
    isMetalStyleCall = true;
  } else {
    /**
     * Crypto:
     *
     * saveCandles("BTC", "GBP", candles)
     */
    currency =
      normalizeCurrency(
        currencyOrCandles
      );

    candles = maybeCandles;
  }

  if (!Array.isArray(candles)) {
    throw new Error(
      "saveCandles requires an array of candles"
    );
  }

  if (candles.length === 0) {
    return {
      written: 0,
      total: 0,
      symbol: normalizedSymbol,
      currency,
    };
  }

  const normalizedCandles =
    isMetalStyleCall
      ? normalizeMetalCandles(
          normalizedSymbol,
          candles
        )
      : normalizeCryptoCandles(
          normalizedSymbol,
          currency,
          candles
        );

  const collection =
    isMetalStyleCall
      ? metalCandlesCollection(
          normalizedSymbol
        )
      : cryptoCandlesCollection(
          normalizedSymbol,
          currency
        );

  let written = 0;

  for (
    let batchStart = 0;
    batchStart <
      normalizedCandles.length;
    batchStart += MAX_BATCH_SIZE
  ) {
    const batchCandles =
      normalizedCandles.slice(
        batchStart,
        batchStart +
          MAX_BATCH_SIZE
      );

    const batch = db.batch();

    for (const candle of batchCandles) {
      const id =
        isMetalStyleCall
          ? metalCandleDocumentId(
              normalizedSymbol,
              candle.timestamp
            )
          : cryptoCandleDocumentId(
              normalizedSymbol,
              currency,
              candle.timestamp
            );

      const ref =
        collection.doc(id);

      batch.set(
        ref,
        {
          ...candle,

          symbol:
            normalizedSymbol,

          currency,

          timestamp:
            candle.timestamp,

          updatedAt:
            new Date().toISOString(),
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
    total:
      normalizedCandles.length,
    symbol:
      normalizedSymbol,
    currency,
  };
}

/* ============================================================================
   LATEST CANDLE
   ========================================================================== */

/**
 * Existing compatible API.
 *
 * Crypto:
 *
 *   getLatestCandle("BTC", "GBP")
 *
 * Metals:
 *
 *   getLatestCandle("XAU")
 *
 * Metals default to USD.
 */
export async function getLatestCandle(
  symbol,
  currency = "USD"
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  const normalizedCurrency =
    normalizeCurrency(currency);

  /**
   * Metals always use USD.
   *
   * If the metals job calls:
   *
   * getLatestCandle("XAU")
   *
   * this resolves to the USD collection.
   */
  const collection =
    cryptoCandlesCollection(
      normalizedSymbol,
      normalizedCurrency
    );

  const snapshot =
    await collection
      .orderBy(
        "timestamp",
        "desc"
      )
      .limit(1)
      .get();

  if (snapshot.empty) {
    return null;
  }

  const doc =
    snapshot.docs[0];

  return {
    id: doc.id,
    ...doc.data(),
  };
}

/* ============================================================================
   EARLIEST CANDLE
   ========================================================================== */

export async function getEarliestCandle(
  symbol,
  currency = "USD"
) {
  const collection =
    cryptoCandlesCollection(
      symbol,
      currency
    );

  const snapshot =
    await collection
      .orderBy(
        "timestamp",
        "asc"
      )
      .limit(1)
      .get();

  if (snapshot.empty) {
    return null;
  }

  const doc =
    snapshot.docs[0];

  return {
    id: doc.id,
    ...doc.data(),
  };
}

/* ============================================================================
   CANDLE BOUNDS
   ========================================================================== */

export async function getCandleBounds(
  symbol,
  currency = "USD"
) {
  const [
    earliest,
    latest,
  ] = await Promise.all([
    getEarliestCandle(
      symbol,
      currency
    ),

    getLatestCandle(
      symbol,
      currency
    ),
  ]);

  return {
    earliest,
    latest,
  };
}

/* ============================================================================
   GET CANDLES
   ========================================================================== */

/**
 * Existing compatible API.
 *
 * Crypto:
 *
 *   getCandles(
 *     "BTC",
 *     "GBP",
 *     start,
 *     end
 *   )
 *
 * Metals:
 *
 *   getCandles(
 *     "XAU",
 *     "USD",
 *     start,
 *     end
 *   )
 */
export async function getCandles(
  symbol,
  currency,
  startTimestamp,
  endTimestamp
) {
  const collection =
    cryptoCandlesCollection(
      symbol,
      currency
    );

  const start =
    normalizeTimestamp(
      startTimestamp
    );

  const end =
    normalizeTimestamp(
      endTimestamp
    );

  if (start > end) {
    throw new Error(
      "startTimestamp must be before endTimestamp"
    );
  }

  const snapshot =
    await collection
      .where(
        "timestamp",
        ">=",
        start
      )
      .where(
        "timestamp",
        "<=",
        end
      )
      .orderBy(
        "timestamp",
        "asc"
      )
      .get();

  return snapshot.docs.map(
    (doc) => ({
      id: doc.id,
      ...doc.data(),
    })
  );
}

/* ============================================================================
   SUPPORTED SERIES
   ========================================================================== */

export function getSupportedSeries() {
  const series = [];

  for (
    const symbol of
      SUPPORTED_SYMBOLS
  ) {
    for (
      const currency of
        SUPPORTED_CURRENCIES
    ) {
      series.push({
        symbol,
        currency,
      });
    }
  }

  return series;
}