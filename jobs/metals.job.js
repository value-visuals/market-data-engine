// jobs/metals.job.js

import axios from "axios";

import {
  saveMetalCandles,
  saveMetalIngestionRun,
} from "../repositories/market-data.repository.js";

const NINJAS_BASE = "https://api.api-ninjas.com/v1";

const API_KEY =
  process.env.API_NINJA_API_KEY ||
  process.env.API_NINJAS_API_KEY ||
  process.env.API_NINJA_APIKEY;

const METALS = {
  XAU: {
    symbol: "XAU",
    name: "gold",
  },

  XAG: {
    symbol: "XAG",
    name: "silver",
  },
};

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------

function unixNowSec() {
  return Math.floor(Date.now() / 1000);
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function ninjaGet(path, params = {}) {
  if (!API_KEY) {
    throw new Error(
      "API_NINJA_API_KEY is not configured"
    );
  }

  try {
    const { data } = await axios.get(
      `${NINJAS_BASE}${path}`,
      {
        params,
        headers: {
          "X-Api-Key": API_KEY,
        },
        timeout: 10_000,
      }
    );

    return data;
  } catch (err) {
    const status = err?.response?.status;

    const message =
      err?.response?.data?.error ||
      err?.response?.data?.message ||
      err?.message ||
      "API-Ninjas request failed";

    const error = new Error(message);

    error.status = status || 500;

    throw error;
  }
}

// ---------------------------------------------------------
// Fetch historical metal data
// ---------------------------------------------------------

async function fetchHistoricalMetal({
  name,
  period,
  start,
  end,
}) {
  const response = await ninjaGet(
    "/commoditypricehistorical",
    {
      name,
      period,
      start,
      end,
    }
  );

  const values = Array.isArray(response)
    ? response
    : Array.isArray(response?.prices)
      ? response.prices
      : [];

  const candles = [];

  for (const value of values) {
    const time = Number(value?.time);

    if (!Number.isFinite(time)) {
      continue;
    }

    const open = toNum(value?.open);
    const high = toNum(value?.high);
    const low = toNum(value?.low);

    const close = toNum(
      value?.close ?? value?.price
    );

    const volume = toNum(value?.volume);

    if (
      open == null &&
      high == null &&
      low == null &&
      close == null
    ) {
      continue;
    }

    candles.push({
      t: time * 1000,
      o: open,
      h: high,
      l: low,
      c: close,

      ...(volume != null
        ? { v: volume }
        : {}),
    });
  }

  // API-Ninjas may return newest → oldest.
  candles.sort((a, b) => a.t - b.t);

  // Remove duplicate timestamps.
  const unique = [];

  let lastTimestamp = null;

  for (const candle of candles) {
    if (candle.t === lastTimestamp) {
      // Keep the latest occurrence.
      unique[unique.length - 1] = candle;
    } else {
      unique.push(candle);
      lastTimestamp = candle.t;
    }
  }

  return unique;
}

// ---------------------------------------------------------
// Ingest ONE metal
// ---------------------------------------------------------

export async function ingestMetal({
  symbol = "XAU",
  days = 1,
  period = "1h",
} = {}) {
  const normalizedSymbol =
    String(symbol).trim().toUpperCase();

  const metal = METALS[normalizedSymbol];

  if (!metal) {
    throw new Error(
      `Unsupported metal symbol: ${normalizedSymbol}. ` +
        `Supported symbols: ${Object.keys(METALS).join(", ")}`
    );
  }

  const end = unixNowSec();

  const start =
    end - Number(days) * 24 * 60 * 60;

  console.log(
    `\n[metals] Starting ${metal.symbol} ingestion`
  );

  console.log(
    `  Range: ${new Date(
      start * 1000
    ).toISOString()} → ${new Date(
      end * 1000
    ).toISOString()}`
  );

  console.log(`  Period: ${period}`);

  const candles =
    await fetchHistoricalMetal({
      name: metal.name,
      period,
      start,
      end,
    });

  console.log(
    `  API-Ninjas returned ${candles.length} candles`
  );

  if (candles.length === 0) {
    console.log(
      `  No ${metal.symbol} candles returned.`
    );

    return {
      symbol: metal.symbol,
      name: metal.name,
      period,
      saved: 0,
    };
  }

  const result = await saveMetalCandles({
    symbol: metal.symbol,
    interval: period,
    candles,
    provider: "api-ninjas",
    currency: "USD",
  });

  await saveMetalIngestionRun({
    symbol: metal.symbol,
    interval: period,
    startMs: start * 1000,
    endMs: end * 1000,
    provider: "api-ninjas",
    candleCount: result.saved,
  });

  console.log(
    `  ✓ Saved ${result.saved} ${metal.symbol} candles`
  );

  return {
    symbol: metal.symbol,
    name: metal.name,
    period,
    saved: result.saved,
  };
}

// ---------------------------------------------------------
// Ingest ALL configured metals
// ---------------------------------------------------------

export async function ingestMetals({
  days = 1,
  period = "1h",
} = {}) {
  const results = [];

  for (const symbol of Object.keys(METALS)) {
    try {
      const result = await ingestMetal({
        symbol,
        days,
        period,
      });

      results.push({
        ...result,
        ok: true,
      });
    } catch (error) {
      console.error(
        `\n[metals] ✗ ${symbol} ingestion failed`
      );

      console.error(
        `  ${error.message}`
      );

      results.push({
        symbol,
        ok: false,
        error: error.message,
      });
    }
  }

  return results;
}