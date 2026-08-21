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

  // API-Ninjas uses Unix seconds.
  return value < 10_000_000_000
    ? value * 1000
    : value;
}

export function normalizeApiNinjasHistorical({
  data,
  symbol,
  baseAsset,
  quoteAsset = "USD",
  interval,
}) {
  const values = Array.isArray(data)
    ? data
    : Array.isArray(data?.prices)
      ? data.prices
      : [];

  return values
    .map((item) => ({
      symbol: `${baseAsset}/${quoteAsset}`,
      baseAsset,
      quoteAsset,

      interval,

      timestamp: normalizeTimestamp(item?.time),

      open: toNumber(item?.open),
      high: toNumber(item?.high),
      low: toNumber(item?.low),
      close: toNumber(item?.close ?? item?.price),

      volume: toNumber(item?.volume),

      provider: "api-ninjas",
    }))
    .filter((item) => item.timestamp !== null)
    .sort((a, b) => a.timestamp - b.timestamp);
}

