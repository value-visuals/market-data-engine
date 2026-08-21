const BASE_URL = "https://api.coingecko.com/api/v3";

const API_KEY = process.env.COINGECKO_API_KEY;

async function get(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  });

  const headers = {
    accept: "application/json",
  };

  if (API_KEY) {
    headers["x-cg-demo-api-key"] = API_KEY;
  }

  const response = await fetch(url, {
    headers,
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `CoinGecko ${response.status}: ${text}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("CoinGecko returned invalid JSON");
  }
}

export async function getMarketChart({
  coinId,
  vsCurrency = "usd",
  from,
  to,
}) {
  return get(`/coins/${coinId}/market_chart/range`, {
    vs_currency: vsCurrency,
    from,
    to,
  });
}

export async function getSimplePrice({
  coinIds,
  vsCurrency = "usd",
}) {
  return get("/simple/price", {
    ids: coinIds.join(","),
    vs_currencies: vsCurrency,
    include_market_cap: "true",
    include_24hr_vol: "true",
    include_24hr_change: "true",
  });
}

export default {
  getMarketChart,
  getSimplePrice,
};