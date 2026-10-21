// Kept separate from crypto/metals candle normalization: market cap is a snapshot,
// not an OHLC series, and metal spot prices must remain in their existing feeds.

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizedRow(value) {
  if (!value || typeof value !== "object") throw new Error("Invalid AssetMarketCap ranking row");
  const rank = Number(value.Rank);
  const ticker = typeof value.Ticker === "string" ? value.Ticker.trim() : "";
  const name = typeof value.Name === "string" ? value.Name.trim() : "";
  const assetType = typeof value.AssetType === "string" ? value.AssetType.trim() : "";
  const marketCapUsd = finiteOrNull(value.MarketCap);
  const priceUsd = finiteOrNull(value.Price);
  const change24hPct = finiteOrNull(value["24HrChange"]);
  const circulatingSupply = finiteOrNull(value.CirculatingSupply);

  if (!Number.isInteger(rank) || rank < 1 || rank > 100 || !ticker || !name || !assetType ||
      ticker.length > 64 || name.length > 180 || assetType.length > 80 ||
      marketCapUsd === null || marketCapUsd <= 0 ||
      (priceUsd !== null && priceUsd < 0) ||
      (circulatingSupply !== null && circulatingSupply < 0)) {
    throw new Error("Invalid AssetMarketCap ranking row fields");
  }

  return {
    rank, ticker, name, assetType, marketCapUsd, priceUsd,
    change24hPct, circulatingSupply,
  };
}

export function normalizeAssetMarketCapSnapshot(payload, fetchedAt = new Date().toISOString()) {
  const raw = payload?.data;
  if (!Array.isArray(raw) || raw.length < 50 || raw.length > 100) {
    throw new Error("AssetMarketCap Top 100 is missing or incomplete");
  }
  const data = raw.map(normalizedRow);
  const ranks = new Set(data.map((row) => row.rank));
  if (ranks.size !== data.length) throw new Error("AssetMarketCap supplied duplicate ranks");
  data.sort((a, b) => a.rank - b.rank);

  // An incomplete payload should never erase Gold/Silver caps from a good snapshot.
  for (const metal of ["gold", "silver"]) {
    if (!data.some((row) => row.name.toLowerCase() === metal &&
        /commodity|metal/i.test(row.assetType))) {
      throw new Error(`AssetMarketCap Top 100 does not include ${metal}`);
    }
  }

  const asOfValue = payload?.metadata?.asOf;
  const asOf = typeof asOfValue === "string" && Number.isFinite(Date.parse(asOfValue))
    ? new Date(asOfValue).toISOString() : null;

  return {
    source: "AssetMarketCap",
    sourceUrl: "https://assetmarketcap.com/",
    currency: "USD",
    asOf,
    fetchedAt,
    count: data.length,
    // Keep the provider metadata for future API enrichment. These are reference
    // quotes only; the live crypto/metals price feeds are not changed.
    metadata: {
      marketCapTotalUsd: finiteOrNull(payload?.metadata?.marketCapTotal),
      totalAssets: finiteOrNull(payload?.metadata?.totalAssets),
      goldUsdPerOz: finiteOrNull(payload?.metadata?.goldUsdPerOz),
      silverUsdPerOz: finiteOrNull(payload?.metadata?.silverUsdPerOz),
      btcUsd: finiteOrNull(payload?.metadata?.btcUsd),
    },
    data,
  };
}
