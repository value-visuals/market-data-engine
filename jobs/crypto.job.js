// jobs/crypto.job.js

import {
  saveCryptoCandles,
  saveCryptoIngestionRun,
} from "../repositories/market-data.repository.js";

const COINGECKO_BASE =
  "https://api.coingecko.com/api/v3";

const COINGECKO_API_KEY =
  process.env.COINGECKO_API_KEY || null;

const ASSETS = [
  {
    symbol: "BTC",
    id: "bitcoin",
  },
  {
    symbol: "ETH",
    id: "ethereum",
  },
];

function buildHeaders() {
  const headers = {
    accept: "application/json",
  };

  if (COINGECKO_API_KEY) {
    headers["x-cg-demo-api-key"] =
      COINGECKO_API_KEY;
  }

  return headers;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: buildHeaders(),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `CoinGecko returned ${response.status}: ${text}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "CoinGecko returned invalid JSON"
    );
  }
}

async function fetchMarketChart({
  id,
  days,
}) {
  const url =
    `${COINGECKO_BASE}/coins/${id}/market_chart` +
    `?vs_currency=usd&days=${days}`;

  return fetchJson(url);
}

function buildCandles(data) {
  const prices = Array.isArray(data?.prices)
    ? data.prices
    : [];

  const candles = prices
    .map(([timestamp, price]) => {
      const t = Number(timestamp);
      const value = Number(price);

      if (
        !Number.isFinite(t) ||
        !Number.isFinite(value)
      ) {
        return null;
      }

      return {
        t,
        o: value,
        h: value,
        l: value,
        c: value,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);

  const unique = [];
  let lastTimestamp = null;

  for (const candle of candles) {
    if (candle.t === lastTimestamp) {
      unique[unique.length - 1] = candle;
    } else {
      unique.push(candle);
      lastTimestamp = candle.t;
    }
  }

  return unique;
}

async function ingestAsset({
  symbol,
  id,
  days,
}) {
  const endMs = Date.now();
  const startMs =
    endMs - days * 24 * 60 * 60 * 1000;

  console.log(
    `\n[crypto] Starting ${symbol} ingestion`
  );

  console.log(
    `  Range: ${new Date(startMs).toISOString()} → ${new Date(
      endMs
    ).toISOString()}`
  );

  const data = await fetchMarketChart({
    id,
    days,
  });

  const candles = buildCandles(data);

  console.log(
    `  CoinGecko returned ${candles.length} price points`
  );

  if (candles.length === 0) {
    console.log(
      `  No ${symbol} data returned. Nothing to save.`
    );

    return {
      symbol,
      saved: 0,
    };
  }

  // CoinGecko's free market_chart endpoint gives us
  // price points rather than true OHLC candles.
  //
  // We intentionally preserve that fact by using the
  // same price for o/h/l/c.
  const result = await saveCryptoCandles({
    symbol,
    interval: "auto",
    candles,
    provider: "coingecko",
    currency: "USD",
  });

  await saveCryptoIngestionRun({
    symbol,
    interval: "auto",
    startMs,
    endMs,
    provider: "coingecko",
    candleCount: result.saved,
  });

  console.log(
    `  ✓ Saved ${result.saved} ${symbol} candles`
  );

  return {
    symbol,
    saved: result.saved,
  };
}

export async function ingestCrypto({
  days = 7,
  symbols = ["BTC", "ETH"],
} = {}) {
  const wanted = ASSETS.filter((asset) =>
    symbols
      .map((symbol) => String(symbol).toUpperCase())
      .includes(asset.symbol)
  );

  if (wanted.length === 0) {
    throw new Error(
      "No supported crypto symbols requested"
    );
  }

  const results = [];

  for (const asset of wanted) {
    try {
      const result = await ingestAsset({
        ...asset,
        days,
      });

      results.push({
        ...result,
        ok: true,
      });
    } catch (error) {
      console.error(
        `\n[crypto] ✗ ${asset.symbol} ingestion failed`
      );
      console.error(`  ${error.message}`);

      results.push({
        symbol: asset.symbol,
        ok: false,
        error: error.message,
      });
    }
  }

  return results;
}