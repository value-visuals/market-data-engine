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
 * Maximum historical coverage used when a series has
 * no existing data.
 */
const MAX_HISTORY_DAYS = 365;


/**
 * Assets currently supported by the market-data engine.
 */
const CRYPTO_ASSETS = [
  {
    symbol: "BTC",
    coinId: "bitcoin",
  },

  {
    symbol: "ETH",
    coinId: "ethereum",
  },

  {
    symbol: "XMR",
    coinId: "monero",
  },
];


/**
 * Quote currencies stored independently in Firebase.
 */
const CRYPTO_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
];


/**
 * Normal live lookback.
 *
 * The scheduler runs every 15 minutes, so 20 minutes
 * provides a small safety overlap.
 */
const LIVE_LOOKBACK_MINUTES = 20;


/**
 * CoinGecko can rate-limit rapid successive requests.
 *
 * Keep requests sequential and introduce a small delay
 * between successful requests.
 */
const REQUEST_DELAY_MS = 1500;


/**
 * Retry configuration for HTTP 429 responses.
 *
 * A 429 should not cause the entire crypto ingestion run
 * to fail. We wait and retry the same series.
 */
const MAX_RETRIES = 3;


/**
 * Maximum delay used when CoinGecko supplies a Retry-After
 * response header.
 */
const MAX_RETRY_DELAY_MS = 60_000;


/* ============================================================================
   HELPERS
   ========================================================================== */


/**
 * Normalize currency.
 */
function normalizeCurrency(currency) {
  return String(currency || "")
    .trim()
    .toUpperCase();
}


/**
 * Sleep for the specified number of milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}


/**
 * Extract a useful HTTP status code from an Axios error.
 */
function getHttpStatus(error) {
  return (
    error?.response?.status ??
    error?.status ??
    null
  );
}


/**
 * Calculate a retry delay.
 *
 * Prefer CoinGecko's Retry-After header when available.
 * Otherwise use exponential backoff.
 */
function getRetryDelay(
  error,
  retryNumber
) {
  const retryAfter =
    error?.response?.headers?.["retry-after"] ??
    error?.response?.headers?.["Retry-After"];

  if (retryAfter) {
    const seconds =
      Number(retryAfter);

    if (
      Number.isFinite(seconds) &&
      seconds >= 0
    ) {
      return Math.min(
        seconds * 1000,
        MAX_RETRY_DELAY_MS
      );
    }
  }

  return Math.min(
    2000 *
      Math.pow(
        2,
        retryNumber
      ),
    MAX_RETRY_DELAY_MS
  );
}


/**
 * Fetch CoinGecko market history.
 *
 * CoinGecko returns:
 *
 * {
 *   prices: [
 *     [timestamp, price],
 *     ...
 *   ],
 *   market_caps: [
 *     [timestamp, marketCap],
 *     ...
 *   ],
 *   total_volumes: [
 *     [timestamp, volume],
 *     ...
 *   ]
 * }
 *
 * The timestamp is milliseconds.
 *
 * Requests are retried only for rate limiting and transient
 * server failures.
 */
async function fetchCoinGeckoHistory(
  coinId,
  currency,
  start,
  end
) {
  const normalizedCurrency =
    normalizeCurrency(currency);


  const params = {
    vs_currency:
      normalizedCurrency.toLowerCase(),

    from:
      Math.floor(
        start.getTime() / 1000
      ),

    to:
      Math.floor(
        end.getTime() / 1000
      ),
  };


  const headers = {
    accept: "application/json",
  };


  if (COINGECKO_API_KEY) {
    headers["x-cg-demo-api-key"] =
      COINGECKO_API_KEY;
  }


  for (
    let retry = 0;
    retry <= MAX_RETRIES;
    retry++
  ) {
    try {
      const response =
        await axios.get(
          `${COINGECKO_BASE_URL}/coins/${coinId}/market_chart/range`,
          {
            params,
            headers,
            timeout: 15_000,
          }
        );


      return response.data;
    } catch (error) {
      const status =
        getHttpStatus(error);


      const retryable =
        status === 429 ||
        status >= 500;


      if (
        !retryable ||
        retry >= MAX_RETRIES
      ) {
        throw error;
      }


      const delay =
        getRetryDelay(
          error,
          retry
        );


      console.warn(
        `[crypto] CoinGecko ${status} for ` +
        `${coinId}/${normalizedCurrency}. ` +
        `Retrying in ${delay}ms ` +
        `(attempt ${retry + 1}/${MAX_RETRIES})`
      );


      await sleep(delay);
    }
  }


  throw new Error(
    "CoinGecko request failed after retries"
  );
}


/**
 * Convert CoinGecko's parallel arrays into our candle shape.
 *
 * CoinGecko's historical market-chart endpoint is price-based
 * rather than true OHLC candle data.
 *
 * Therefore:
 *
 *   open  = price
 *   high  = price
 *   low   = price
 *   close = price
 *
 * This matches the structure used by the existing chart API.
 */
function normalizeCryptoCandles(
  symbol,
  currency,
  data
) {
  const prices =
    Array.isArray(
      data?.prices
    )
      ? data.prices
      : [];


  const marketCaps =
    Array.isArray(
      data?.market_caps
    )
      ? data.market_caps
      : [];


  const volumes =
    Array.isArray(
      data?.total_volumes
    )
      ? data.total_volumes
      : [];


  /*
   * Build lookup maps for market cap and volume.
   *
   * CoinGecko normally uses matching timestamps, but keeping
   * these independent makes the ingestion more resilient.
   */
  const marketCapMap =
    new Map();


  for (const entry of marketCaps) {
    if (!Array.isArray(entry)) {
      continue;
    }


    const timestamp =
      Number(entry[0]);


    const marketCap =
      Number(entry[1]);


    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(marketCap)
    ) {
      continue;
    }


    marketCapMap.set(
      timestamp,
      marketCap
    );
  }


  const volumeMap =
    new Map();


  for (const entry of volumes) {
    if (!Array.isArray(entry)) {
      continue;
    }


    const timestamp =
      Number(entry[0]);


    const volume =
      Number(entry[1]);


    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(volume)
    ) {
      continue;
    }


    volumeMap.set(
      timestamp,
      volume
    );
  }


  const unique =
    new Map();


  for (const entry of prices) {
    if (!Array.isArray(entry)) {
      continue;
    }


    const timestamp =
      Number(entry[0]);


    const price =
      Number(entry[1]);


    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(price)
    ) {
      continue;
    }


    unique.set(
      timestamp,
      {
        symbol:
          String(symbol)
            .trim()
            .toUpperCase(),

        currency:
          normalizeCurrency(
            currency
          ),

        timestamp,

        open: price,

        high: price,

        low: price,

        close: price,

        price,

        marketCap:
          marketCapMap.get(
            timestamp
          ) ?? null,

        volume:
          volumeMap.get(
            timestamp
          ) ?? null,
      }
    );
  }


  return Array.from(
    unique.values()
  ).sort(
    (a, b) =>
      a.timestamp -
      b.timestamp
  );
}


/**
 * Calculate a start date for historical backfill.
 */
function historyStart(days) {
  const end =
    new Date();


  return new Date(
    end.getTime() -
      days *
        24 *
        60 *
        60 *
        1000
  );
}


/**
 * Build a readable series name for logs.
 */
function seriesName(
  symbol,
  currency
) {
  return (
    `${String(symbol).toUpperCase()}/` +
    `${normalizeCurrency(currency)}`
  );
}


/**
 * Pause between CoinGecko series requests.
 *
 * This is intentionally applied only between successful
 * series requests. Retries have their own backoff.
 */
async function waitBetweenRequests() {
  if (
    REQUEST_DELAY_MS > 0
  ) {
    await sleep(
      REQUEST_DELAY_MS
    );
  }
}


/* ============================================================================
   HISTORICAL INGESTION
   ========================================================================== */


/**
 * Ingest historical crypto data for ONE symbol + currency.
 *
 * Example:
 *
 * ingestCryptoHistory({
 *   symbol: "BTC",
 *   coinId: "bitcoin",
 *   currency: "GBP",
 *   days: 365
 * });
 */
export async function ingestCryptoHistory({
  symbol,
  coinId,
  currency,
  days = MAX_HISTORY_DAYS,
}) {
  const normalizedCurrency =
    normalizeCurrency(currency);


  const end =
    new Date();


  const safeDays =
    Math.min(
      Number(days) || MAX_HISTORY_DAYS,
      MAX_HISTORY_DAYS
    );


  const start =
    historyStart(
      safeDays
    );


  const name =
    seriesName(
      symbol,
      normalizedCurrency
    );


  console.log(
    `\n[crypto] Historical ${name}`
  );


  console.log(
    `  Range: ${start.toISOString()} → ${end.toISOString()}`
  );


  const data =
    await fetchCoinGeckoHistory(
      coinId,
      normalizedCurrency,
      start,
      end
    );


  const candles =
    normalizeCryptoCandles(
      symbol,
      normalizedCurrency,
      data
    );


  console.log(
    `  CoinGecko returned ${candles.length} price points`
  );


  if (
    candles.length === 0
  ) {
    return {
      symbol,

      currency:
        normalizedCurrency,

      written: 0,

      total: 0,
    };
  }


  const result =
    await saveCandles(
      symbol,
      normalizedCurrency,
      candles
    );


  console.log(
    `  ✓ ${name}: ${result.written} written`
  );


  return {
    symbol,

    currency:
      normalizedCurrency,

    ...result,
  };
}


/* ============================================================================
   INCREMENTAL INGESTION
   ========================================================================== */


/**
 * Ingest one crypto series incrementally.
 *
 * Firebase:
 *
 *   1 read → latest candle for symbol + currency
 *
 * CoinGecko:
 *
 *   only request data newer than latest
 */
export async function ingestCryptoAsset({
  symbol,
  coinId,
  currency,
  days,
}) {
  const normalizedCurrency =
    normalizeCurrency(currency);


  const name =
    seriesName(
      symbol,
      normalizedCurrency
    );


  console.log(
    `\n[crypto] Starting ${name} ingestion`
  );


  /*
   * IMPORTANT:
   *
   * The currency is part of the Firebase series.
   *
   * We must therefore ask for the latest candle for
   * BTC/USD, BTC/EUR, BTC/GBP independently.
   */
  const latest =
    await getLatestCandle(
      symbol,
      normalizedCurrency
    );


  const end =
    new Date();


  let start;


  if (
    latest?.timestamp
  ) {
    /*
     * Start immediately after the last stored point.
     */
    start =
      new Date(
        Number(
          latest.timestamp
        ) + 1
      );
  } else {
    /*
     * No data exists yet for this particular
     * symbol + currency combination.
     */
    const historyDays =
      days ??
      MAX_HISTORY_DAYS;


    start =
      historyStart(
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
   * a small lookback.
   *
   * The result is filtered below, so existing points
   * are not written again.
   */
  if (
    latest?.timestamp &&
    end.getTime() -
      start.getTime() <
      LIVE_LOOKBACK_MINUTES *
        60 *
        1000
  ) {
    start =
      new Date(
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
      normalizedCurrency,
      start,
      end
    );


  const candles =
    normalizeCryptoCandles(
      symbol,
      normalizedCurrency,
      data
    );


  /*
   * If we already had data, only keep points newer
   * than the stored latest candle.
   */
  const newCandles =
    latest?.timestamp
      ? candles.filter(
          (candle) =>
            candle.timestamp >
            Number(
              latest.timestamp
            )
        )
      : candles;


  console.log(
    `  CoinGecko returned ${candles.length} price points`
  );


  console.log(
    `  New price points: ${newCandles.length}`
  );


  if (
    newCandles.length === 0
  ) {
    return {
      symbol,

      currency:
        normalizedCurrency,

      written: 0,

      total: 0,
    };
  }


  const result =
    await saveCandles(
      symbol,
      normalizedCurrency,
      newCandles
    );


  console.log(
    `  ✓ ${name}: ${result.written} written`
  );


  return {
    symbol,

    currency:
      normalizedCurrency,

    ...result,
  };
}


/* ============================================================================
   HISTORICAL BACKFILL IF NEEDED
   ========================================================================== */


/**
 * Initial historical ingestion.
 *
 * This checks the specific symbol + currency series.
 *
 * Therefore:
 *
 * BTC/USD existing
 * BTC/EUR missing
 *
 * will correctly cause BTC/EUR to be backfilled.
 */
export async function ingestCryptoHistoryIfNeeded({
  symbol,
  coinId,
  currency,
  days = MAX_HISTORY_DAYS,
}) {
  const normalizedCurrency =
    normalizeCurrency(currency);


  const name =
    seriesName(
      symbol,
      normalizedCurrency
    );


  const latest =
    await getLatestCandle(
      symbol,
      normalizedCurrency
    );


  if (!latest) {
    console.log(
      `\n[crypto] ${name} has no stored data. Loading ${days} days.`
    );


    return ingestCryptoHistory({
      symbol,
      coinId,
      currency:
        normalizedCurrency,
      days,
    });
  }


  /*
   * We intentionally do not automatically re-download
   * historical data on every restart.
   */
  console.log(
    `\n[crypto] ${name} historical data already exists.`
  );


  console.log(
    `  Latest: ${new Date(
      Number(
        latest.timestamp
      )
    ).toISOString()}`
  );


  return {
    symbol,

    currency:
      normalizedCurrency,

    written: 0,

    total: 0,

    skipped: true,
  };
}


/* ============================================================================
   LIVE INGESTION
   ========================================================================== */


/**
 * Normal live ingestion for ALL supported assets
 * and ALL supported currencies.
 *
 * Requests are deliberately sequential.
 *
 * This prevents nine immediate CoinGecko requests from
 * hitting the rate limiter at once.
 */
export async function ingestCrypto() {
  const results = [];


  let requestCompleted = false;


  for (
    const asset of
      CRYPTO_ASSETS
  ) {
    for (
      const currency of
        CRYPTO_CURRENCIES
    ) {
      try {
        const result =
          await ingestCryptoAsset({
            ...asset,
            currency,
          });


        results.push(
          result
        );


        requestCompleted = true;
      } catch (error) {
        console.error(
          `[crypto] Failed ${seriesName(
            asset.symbol,
            currency
          )}:`,
          error?.message ||
            error
        );


        /*
         * Continue with the remaining series.
         *
         * A temporary CoinGecko failure for one series
         * must not prevent the other currencies/assets
         * from being attempted.
         */
        results.push({
          symbol:
            asset.symbol,

          currency:
            normalizeCurrency(
              currency
            ),

          written: 0,

          total: 0,

          error:
            error?.message ||
            String(error),
        });
      }


      /*
       * Do not hammer CoinGecko with back-to-back requests.
       *
       * This is also applied after a failed request because
       * the failure may have been a rate-limit response.
       */
      if (
        requestCompleted ||
        true
      ) {
        await waitBetweenRequests();
      }


      requestCompleted = false;
    }
  }


  return results;
}


/* ============================================================================
   HISTORICAL BACKFILL
   ========================================================================== */


/**
 * Initial historical backfill for ALL supported
 * assets and currencies.
 *
 * Each series is checked independently.
 *
 * This is important when adding a new currency later.
 */
export async function backfillCrypto() {
  const results = [];


  for (
    const asset of
      CRYPTO_ASSETS
  ) {
    for (
      const currency of
        CRYPTO_CURRENCIES
    ) {
      try {
        const result =
          await ingestCryptoHistoryIfNeeded({
            ...asset,
            currency,
          });


        results.push(
          result
        );
      } catch (error) {
        console.error(
          `[crypto] Backfill failed ${seriesName(
            asset.symbol,
            currency
          )}:`,
          error?.message ||
            error
        );


        results.push({
          symbol:
            asset.symbol,

          currency:
            normalizeCurrency(
              currency
            ),

          written: 0,

          total: 0,

          error:
            error?.message ||
            String(error),
        });
      }


      /*
       * Historical backfill can also trigger CoinGecko's
       * rate limiter when a newly-added series is missing.
       *
       * Keep the same spacing between series.
       */
      await waitBetweenRequests();
    }
  }


  return results;
}


/* ============================================================================
   EXPORTS
   ========================================================================== */


/**
 * Useful if another part of the ingestion engine needs to
 * inspect the configured assets/currencies.
 */
export {
  CRYPTO_ASSETS,
  CRYPTO_CURRENCIES,
  MAX_HISTORY_DAYS,
  LIVE_LOOKBACK_MINUTES,
  REQUEST_DELAY_MS,
  MAX_RETRIES,
};