// jobs/crypto.job.js

import axios from "axios";

import {
  saveCandles,
  getLatestCandle,
} from "../repositories/market-data.repository.js";

const COINGECKO_BASE_URL =
  "https://api.coingecko.com/api/v3";

const COINGECKO_API_KEY =
  process.env.COINGECKO_API_KEY || null;

/**
 * CoinGecko's public/demo API has restrictions on
 * historical range requests.
 *
 * Keep this configurable so the ingestion engine doesn't
 * pretend that unlimited history is available.
 */
const MAX_HISTORY_DAYS = 365;

const CRYPTO_ASSETS = [
  {
    symbol: "BTC",
    coinId: "bitcoin",
  },
  {
    symbol: "ETH",
    coinId: "ethereum",
  },
];

/**
 * Normal live ingestion interval.
 *
 * The scheduler itself can run every 15 minutes.
 */
const LIVE_LOOKBACK_MINUTES = 20;

/**
 * Fetch CoinGecko market history.
 */
async function fetchCoinGeckoHistory(
  coinId,
  start,
  end
) {
  const params = {
    vs_currency: "usd",
    from: Math.floor(start.getTime() / 1000),
    to: Math.floor(end.getTime() / 1000),
  };

  const headers = {
    accept: "application/json",
  };

  if (COINGECKO_API_KEY) {
    headers["x-cg-demo-api-key"] =
      COINGECKO_API_KEY;
  }

  const response = await axios.get(
    `${COINGECKO_BASE_URL}/coins/${coinId}/market_chart/range`,
    {
      params,
      headers,
      timeout: 15_000,
    }
  );

  return response.data;
}

/**
 * Normalize CoinGecko response.
 */
function normalizeCryptoCandles(
  symbol,
  data
) {
  const prices = Array.isArray(data?.prices)
    ? data.prices
    : [];

  const unique = new Map();

  for (const entry of prices) {
    if (!Array.isArray(entry)) {
      continue;
    }

    const timestamp = Number(entry[0]);
    const price = Number(entry[1]);

    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(price)
    ) {
      continue;
    }

    unique.set(timestamp, {
      symbol,
      timestamp,
      open: price,
      high: price,
      low: price,
      close: price,
      price,
      volume: null,
    });
  }

  return Array.from(unique.values()).sort(
    (a, b) => a.timestamp - b.timestamp
  );
}

/**
 * Calculate a start date for historical backfill.
 */
function historyStart(days) {
  const end = new Date();

  return new Date(
    end.getTime() -
      days * 24 * 60 * 60 * 1000
  );
}

/**
 * Ingest historical crypto data.
 *
 * This is used for initial historical population.
 */
export async function ingestCryptoHistory({
  symbol,
  coinId,
  days = MAX_HISTORY_DAYS,
}) {
  const end = new Date();

  const safeDays = Math.min(
    days,
    MAX_HISTORY_DAYS
  );

  const start = historyStart(safeDays);

  console.log(
    `\n[crypto] Historical ${symbol}`
  );

  console.log(
    `  Range: ${start.toISOString()} → ${end.toISOString()}`
  );

  const data = await fetchCoinGeckoHistory(
    coinId,
    start,
    end
  );

  const candles =
    normalizeCryptoCandles(
      symbol,
      data
    );

  console.log(
    `  CoinGecko returned ${candles.length} price points`
  );

  if (candles.length === 0) {
    return {
      symbol,
      written: 0,
      total: 0,
    };
  }

  const result = await saveCandles(
    symbol,
    candles
  );

  console.log(
    `  ✓ ${symbol}: ${result.written} written`
  );

  return {
    symbol,
    ...result,
  };
}

/**
 * Ingest one crypto asset incrementally.
 *
 * Firebase:
 *   1 read → latest candle
 *
 * API:
 *   only request data newer than latest
 */
export async function ingestCryptoAsset({
  symbol,
  coinId,
  days,
}) {
  console.log(
    `\n[crypto] Starting ${symbol} ingestion`
  );

  const latest =
    await getLatestCandle(symbol);

  const end = new Date();

  let start;

  if (latest?.timestamp) {
    /*
     * Start immediately after the last stored point.
     *
     * This prevents repeatedly downloading the same
     * historical range.
     */
    start = new Date(
      Number(latest.timestamp) + 1
    );
  } else {
    /*
     * No data exists yet.
     *
     * Use the configured historical period.
     */
    const historyDays =
      days ?? MAX_HISTORY_DAYS;

    start = historyStart(
      Math.min(
        historyDays,
        MAX_HISTORY_DAYS
      )
    );
  }

  /*
   * Safety fallback:
   *
   * If the latest candle is extremely recent, request
   * a small lookback. This helps recover a missing point
   * if the upstream API has slightly different timestamps.
   */
  if (
    latest?.timestamp &&
    end.getTime() - start.getTime() <
      LIVE_LOOKBACK_MINUTES * 60 * 1000
  ) {
    start = new Date(
      end.getTime() -
        LIVE_LOOKBACK_MINUTES *
          60 *
          1000
    );
  }

  console.log(
    `  Range: ${start.toISOString()} → ${end.toISOString()}`
  );

  const data =
    await fetchCoinGeckoHistory(
      coinId,
      start,
      end
    );

  const candles =
    normalizeCryptoCandles(
      symbol,
      data
    );

  /*
   * If we already had data, only keep points
   * newer than the stored latest candle.
   */
  const newCandles = latest?.timestamp
    ? candles.filter(
        (candle) =>
          candle.timestamp >
          Number(latest.timestamp)
      )
    : candles;

  console.log(
    `  CoinGecko returned ${candles.length} price points`
  );

  console.log(
    `  New price points: ${newCandles.length}`
  );

  if (newCandles.length === 0) {
    return {
      symbol,
      written: 0,
      total: 0,
    };
  }

  const result = await saveCandles(
    symbol,
    newCandles
  );

  console.log(
    `  ✓ ${symbol}: ${result.written} written`
  );

  return {
    symbol,
    ...result,
  };
}

/**
 * Initial historical ingestion.
 *
 * This should only be called when historical coverage
 * is missing.
 */
export async function ingestCryptoHistoryIfNeeded({
  symbol,
  coinId,
  days = MAX_HISTORY_DAYS,
}) {
  const latest =
    await getLatestCandle(symbol);

  if (!latest) {
    console.log(
      `\n[crypto] ${symbol} has no stored data. Loading ${days} days.`
    );

    return ingestCryptoHistory({
      symbol,
      coinId,
      days,
    });
  }

  /*
   * We intentionally do not automatically re-download
   * 365 days on every restart.
   */
  console.log(
    `\n[crypto] ${symbol} historical data already exists.`
  );

  console.log(
    `  Latest: ${new Date(
      Number(latest.timestamp)
    ).toISOString()}`
  );

  return {
    symbol,
    written: 0,
    total: 0,
    skipped: true,
  };
}

/**
 * Normal live ingestion for all assets.
 */
export async function ingestCrypto() {
  const results = [];

  for (const asset of CRYPTO_ASSETS) {
    const result =
      await ingestCryptoAsset(asset);

    results.push(result);
  }

  return results;
}

/**
 * Initial historical backfill for all assets.
 */
export async function backfillCrypto() {
  const results = [];

  for (const asset of CRYPTO_ASSETS) {
    const result =
      await ingestCryptoHistoryIfNeeded(
        asset
      );

    results.push(result);
  }

  return results;
}