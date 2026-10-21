// Fetch only the documented, free Top 100 endpoint. Never put API keys in URLs.
export class AssetMarketCapRequestError extends Error {
  constructor(status, retryAfterMs = 0) {
    super(`AssetMarketCap HTTP ${status}`);
    this.name = "AssetMarketCapRequestError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfter(value, nowMs) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - nowMs) : 0;
}

export async function fetchAssetMarketCap({ apiKey, fetchImpl = globalThis.fetch, nowMs = Date.now() }) {
  if (!apiKey || !apiKey.trim()) throw new Error("ASSETMARKETCAP_API_KEY is not configured");

  const response = await fetchImpl("https://assetmarketcap.com/API/daily", {
    method: "GET",
    headers: { "X-API-Key": apiKey.trim(), Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    redirect: "error", // never forward a secret header to another host
    cache: "no-store",
  });

  if (!response.ok) {
    throw new AssetMarketCapRequestError(
      response.status,
      response.status === 429 ? parseRetryAfter(response.headers.get("retry-after"), nowMs) : 0,
    );
  }

  const declaredBytes = Number(response.headers.get("content-length") ?? 0);
  if (declaredBytes > 2_000_000) throw new Error("AssetMarketCap payload exceeds size limit");
  const body = await response.text();
  if (body.length > 2_000_000) throw new Error("AssetMarketCap payload exceeds size limit");
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("AssetMarketCap returned malformed JSON");
  }
}
