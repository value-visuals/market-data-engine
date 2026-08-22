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
 * Desired historical coverage.
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

/**
 * Backfill one metal.
 *
 * IMPORTANT:
 *
 * We only do this when historical data is missing.
 */
export async function backfillMetal({
  symbol,
  name,
  days = HISTORY_DAYS,
}) {
  const latest =
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
    `\n[metals] ${symbol}: loading ${days} days`
  );

  const end = new Date();

  let chunkEnd = end;
  let daysRemaining = days;

  let totalWritten = 0;
  let totalReturned = 0;

  while (daysRemaining > 0) {
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
      `\n[ backfill ] ${symbol}: ` +
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
      result.written;

    totalReturned +=
      result.total;

    chunkEnd = chunkStart;

    daysRemaining -=
      chunkDays;
  }

  return {
    symbol,
    written: totalWritten,
    total: totalReturned,
  };
}

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

/**
 * Backfill all metals.
 */
export async function backfillMetals() {
  const results = [];

  for (const metal of METALS) {
    const result =
      await backfillMetal({
        ...metal,
        days: HISTORY_DAYS,
      });

    results.push(result);
  }

  return results;
}

/**
 * Normal live ingestion.
 */
export async function ingestMetals() {
  const results = [];

  for (const metal of METALS) {
    const result =
      await ingestMetalIncremental(
        metal
      );

    results.push(result);
  }

  return results;
}