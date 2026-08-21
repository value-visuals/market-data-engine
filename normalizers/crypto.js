function toNumber(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function normalizeTimestamp(timestamp) {
  const value = Number(timestamp);

  if (!Number.isFinite(value)) {
    return null;
  }

  // CoinGecko timestamps are milliseconds.
  return value < 10_000_000_000
    ? value * 1000
    : value;
}

export function normalizeCoinGeckoMarketChart({
  data,
  symbol,
  coinId,
  quoteAsset = "USD",
}) {
  const prices = new Map(
    (data?.prices || []).map(([timestamp, price]) => [
      normalizeTimestamp(timestamp),
      toNumber(price),
    ])
  );

  const marketCaps = new Map(
    (data?.market_caps || []).map(([timestamp, value]) => [
      normalizeTimestamp(timestamp),
      toNumber(value),
    ])
  );

  const volumes = new Map(
    (data?.total_volumes || []).map(([timestamp, value]) => [
      normalizeTimestamp(timestamp),
      toNumber(value),
    ])
  );

  return [...prices.entries()]
    .filter(([timestamp]) => timestamp !== null)
    .sort(([a], [b]) => a - b)
    .map(([timestamp, price]) => ({
      symbol: `${symbol}/${quoteAsset}`,
      baseAsset: symbol,
      quoteAsset,

      interval: null,

      timestamp,

      open: price,
      high: price,
      low: price,
      close: price,

      volume: volumes.get(timestamp) ?? null,
      marketCap: marketCaps.get(timestamp) ?? null,

      provider: "coingecko",
      providerAssetId: coinId,
    }));
}

