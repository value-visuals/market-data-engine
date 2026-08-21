const BASE_URL = "https://api.api-ninjas.com/v1";

const API_KEY =
  process.env.API_NINJA_API_KEY ||
  process.env.API_NINJAS_API_KEY ||
  process.env.API_NINJA_APIKEY;

if (!API_KEY) {
  console.warn(
    "[api-ninjas] API key is not configured"
  );
}

async function get(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url, {
    headers: {
      "X-Api-Key": API_KEY,
      accept: "application/json",
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `API-Ninjas ${response.status}: ${text}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "API-Ninjas returned invalid JSON"
    );
  }
}

export async function getCommodityPrice(name) {
  return get("/commodityprice", {
    name,
  });
}

export async function getCommodityHistorical({
  name,
  period,
  start,
  end,
}) {
  return get("/commoditypricehistorical", {
    name,
    period,
    start,
    end,
  });
}

export default {
  getCommodityPrice,
  getCommodityHistorical,
};