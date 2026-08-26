// jobs/metals.job.js

import axios from "axios";

import {
  saveCandles,
  getLatestCandle,
} from "../repositories/market-data.repository.js";

const NINJAS_BASE_URL =
  "https://api.api-ninjas.com/v1";

const API_KEY =
  process.env.API_NINJA_API_KEY ||
  process.env.API_NINJAS_API_KEY ||
  process.env.API_NINJA_APIKEY;

const METALS = [
  {
    symbol: "XAU",
    name: "gold",
  },
  {
    symbol: "XAG",
    name: "silver",
  },
];

const PERIOD = "1h";

/**
 * Maximum desired historical coverage.
 *
 * This is a MAXIMUM, not an instruction to blindly download
 * the entire period if historical data is already present.
 */
const HISTORY_DAYS =
  30 * 365;

/**
 * API request chunks.
 *
 * Keeping these small avoids huge API requests.
 */
const HISTORICAL_CHUNK_DAYS = 30;

/**
 * Normal live lookback.
 */
const LIVE_LOOKBACK_HOURS = 6;

if (!API_KEY) {
  console.warn(
    "[metals.job] API Ninjas API key is not configured."
  );
}

/* ============================================================================
   HELPERS
   ========================================================================== */

/**
 * Fetch historical metal prices.
 */
async function fetchMetalHistory(
  name,
  start,
  end,
  period = PERIOD
) {
  if (!API_KEY) {
    throw new Error(
      "API-Ninjas API key is not configured"
    );
  }

  const response = await axios.get(
    `${NINJAS_BASE_URL}/commoditypricehistorical`,
    {
      params: {
        name,
        period,
        start: Math.floor(
          start.getTime() / 1000
        ),
        end: Math.floor(
          end.getTime() / 1000
        ),
      },
      headers: {
        "X-Api-Key": API_KEY,
      },
      timeout: 15_000,
    }
  );

  return response.data;
}

/**
 * Normalize API-Ninjas response.
 */
function normalizeMetalCandles(
  symbol,
  data
) {
  const values = Array.isArray(data)
    ? data
    : Array.isArray(data?.prices)
      ? data.prices
      : [];

  const unique = new Map();

  for (const value of values) {
    const timestamp = Number(
      value?.time
    );

    if (!Number.isFinite(timestamp)) {
      continue;
    }

    const timestampMs =
      timestamp * 1000;

    const open = Number(value?.open);
    const high = Number(value?.high);
    const low = Number(value?.low);

    const close = Number(
      value?.close ??
        value?.price
    );

    const volume = Number(
      value?.volume
    );

    unique.set(timestampMs, {
      symbol,

      timestamp: timestampMs,

      open: Number.isFinite(open)
        ? open
        : null,

      high: Number.isFinite(high)
        ? high
        : null,

      low: Number.isFinite(low)
        ? low
        : null,

      close: Number.isFinite(close)
        ? close
        : null,

      price: Number.isFinite(close)
        ? close
        : null,

      volume: Number.isFinite(volume)
        ? volume
        : null,
    });
  }

  return Array.from(
    unique.values()
  ).sort(
    (a, b) =>
      a.timestamp - b.timestamp
  );
}

/* ============================================================================
   RANGE INGESTION
   ========================================================================== */

/**
 * Ingest one metal range.
 */
export async function ingestMetal({
  symbol,
  name,
  days,
  start: providedStart,
  end: providedEnd,
  period = PERIOD,
}) {
  const end =
    providedEnd ?? new Date();

  const start =
    providedStart ??
    new Date(
      end.getTime() -
        days *
          24 *
          60 *
          60 *
          1000
    );

  console.log(
    `\n[metals] Starting ${symbol} ingestion`
  );

  console.log(
    `  Range: ${start.toISOString()} → ${end.toISOString()}`
  );

  console.log(
    `  Period: ${period}`
  );

  const data =
    await fetchMetalHistory(
      name,
      start,
      end,
      period
    );

  const candles =
    normalizeMetalCandles(
      symbol,
      data
    );

  console.log(
    `  API-Ninjas returned ${candles.length} candles`
  );

  if (candles.length === 0) {
    console.log(
      `  No ${symbol} candles returned`
    );

    return {
      symbol,
      written: 0,
      total: 0,
    };
  }

  const result =
    await saveCandles(
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

/* ============================================================================
   HISTORICAL BACKFILL
   ========================================================================== */

/**
 * Backfill one metal.
 *
 * IMPORTANT:
 *
 * The job does NOT blindly assume the entire HISTORY_DAYS
 * period needs to be downloaded.
 *
 * It checks Firebase before starting and after every chunk.
 *
 * Once historical data exists, the backfill stops.
 *
 * This prevents the job from continuing through the entire
 * configured historical window unnecessarily.
 */
export async function backfillMetal({
  symbol,
  name,
  days = HISTORY_DAYS,
}) {
  /*
   * First check.
   *
   * If this series already exists, there is nothing to
   * backfill.
   */
  let latest =
    await getLatestCandle(symbol);

  if (latest) {
    console.log(
      `\n[metals] ${symbol} historical data already exists.`
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

  console.log(
    `\n[metals] ${symbol}: loading up to ${days} days`
  );

  const end = new Date();

  let chunkEnd = end;

  let daysRemaining =
    Math.min(
      Number(days) || HISTORY_DAYS,
      HISTORY_DAYS
    );

  let totalWritten = 0;
  let totalReturned = 0;

  /*
   * Process historical data backwards in chunks.
   */
  while (daysRemaining > 0) {
    /*
     * IMPORTANT:
     *
     * Re-check Firebase BEFORE every chunk.
     *
     * Another process/job may have populated this series
     * since the initial check.
     */
    latest =
      await getLatestCandle(symbol);

    if (latest) {
      console.log(
        `\n[metals] ${symbol} data detected during backfill.`
      );

      console.log(
        `  Latest: ${new Date(
          Number(latest.timestamp)
        ).toISOString()}`
      );

      console.log(
        `  ✓ ${symbol} backfill stopped.`
      );

      break;
    }

    const chunkDays =
      Math.min(
        HISTORICAL_CHUNK_DAYS,
        daysRemaining
      );

    const chunkStart =
      new Date(
        chunkEnd.getTime() -
          chunkDays *
            24 *
            60 *
            60 *
            1000
      );

    console.log(
      `\n[backfill] ${symbol}: ` +
      `${chunkStart.toISOString()} → ` +
      `${chunkEnd.toISOString()}`
    );

    const result =
      await ingestMetal({
        symbol,
        name,
        start: chunkStart,
        end: chunkEnd,
        period: PERIOD,
      });

    totalWritten +=
      Number(result.written) || 0;

    totalReturned +=
      Number(result.total) || 0;

    /*
     * IMPORTANT:
     *
     * If this chunk successfully wrote data, the series
     * now exists in Firebase.
     *
     * There is no reason to continue blindly through the
     * remaining historical chunks.
     */
    if (
      Number(result.written) > 0
    ) {
      console.log(
        `\n[metals] ${symbol}: historical data found.`
      );

      console.log(
        `  ✓ Backfill stopped after first populated chunk.`
      );

      break;
    }

    /*
     * No candles were written.
     *
     * Move further backwards.
     */
    chunkEnd = chunkStart;

    daysRemaining -=
      chunkDays;
  }

  /*
   * Final state check.
   */
  latest =
    await getLatestCandle(symbol);

  if (latest) {
    console.log(
      `\n[metals] ${symbol} backfill complete.`
    );

    console.log(
      `  Latest stored candle: ${new Date(
        Number(latest.timestamp)
      ).toISOString()}`
    );
  } else if (
    daysRemaining <= 0
  ) {
    console.log(
      `\n[metals] ${symbol}: reached maximum historical range.`
    );

    console.log(
      `  No historical data was found within ${days} days.`
    );
  }

  return {
    symbol,
    written: totalWritten,
    total: totalReturned,
    skipped: false,
  };
}

/* ============================================================================
   INCREMENTAL LIVE INGESTION
   ========================================================================== */

/**
 * Incremental live ingestion.
 *
 * Firebase:
 *   one read → latest candle
 *
 * Then only request data newer than that point.
 */
export async function ingestMetalIncremental({
  symbol,
  name,
  period = PERIOD,
}) {
  console.log(
    `\n[metals] Starting ${symbol} ingestion`
  );

  const latest =
    await getLatestCandle(symbol);

  const end = new Date();

  let start;

  if (latest?.timestamp) {
    start = new Date(
      Number(latest.timestamp) + 1
    );
  } else {
    start = new Date(
      end.getTime() -
        LIVE_LOOKBACK_HOURS *
          60 *
          60 *
          1000
    );
  }

  /*
   * Safety overlap.
   *
   * The API is queried over a small overlapping period,
   * but we filter out anything already stored.
   */
  if (
    latest?.timestamp &&
    end.getTime() -
      start.getTime() <
      LIVE_LOOKBACK_HOURS *
        60 *
        60 *
        1000
  ) {
    start = new Date(
      end.getTime() -
        LIVE_LOOKBACK_HOURS *
          60 *
          60 *
          1000
    );
  }

  console.log(
    `  Range: ${start.toISOString()} → ${end.toISOString()}`
  );

  console.log(
    `  Period: ${period}`
  );

  const data =
    await fetchMetalHistory(
      name,
      start,
      end,
      period
    );

  const candles =
    normalizeMetalCandles(
      symbol,
      data
    );

  /*
   * Only save data newer than the last stored candle.
   */
  const newCandles =
    latest?.timestamp
      ? candles.filter(
          (candle) =>
            candle.timestamp >
            Number(latest.timestamp)
        )
      : candles;

  console.log(
    `  API-Ninjas returned ${candles.length} candles`
  );

  console.log(
    `  New candles: ${newCandles.length}`
  );

  if (newCandles.length === 0) {
    return {
      symbol,
      written: 0,
      total: 0,
    };
  }

  const result =
    await saveCandles(
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

/* ============================================================================
   ALL METALS BACKFILL
   ========================================================================== */

/**
 * Backfill all metals.
 */
export async function backfillMetals() {
  const results = [];

  for (const metal of METALS) {
    try {
      const result =
        await backfillMetal({
          ...metal,
          days: HISTORY_DAYS,
        });

      results.push(result);
    } catch (error) {
      console.error(
        `[metals] Backfill failed ${metal.symbol}:`,
        error?.message ||
          error
      );

      results.push({
        symbol: metal.symbol,
        written: 0,
        total: 0,
        error:
          error?.message ||
          String(error),
      });
    }
  }

  return results;
}

/* ============================================================================
   NORMAL LIVE INGESTION
   ========================================================================== */

/**
 * Normal live ingestion.
 */
export async function ingestMetals() {
  const results = [];

  for (const metal of METALS) {
    try {
      const result =
        await ingestMetalIncremental(
          metal
        );

      results.push(result);
    } catch (error) {
      console.error(
        `[metals] Ingestion failed ${metal.symbol}:`,
        error?.message ||
          error
      );

      results.push({
        symbol: metal.symbol,
        written: 0,
        total: 0,
        error:
          error?.message ||
          String(error),
      });
    }
  }

  return results;
}