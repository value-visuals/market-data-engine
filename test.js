// index.js

import "dotenv/config";

import { db } from "./config/firebase.js";

const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
const API_NINJAS_BASE_URL = "https://api.api-ninjas.com/v1";

// -----------------------------------------------------------------------------
// Firebase
// -----------------------------------------------------------------------------

async function testFirebase() {
  const snapshot = await db
    .collection("_system")
    .doc("health")
    .get();

  return {
    ok: true,
    healthDocumentExists: snapshot.exists,
  };
}

// -----------------------------------------------------------------------------
// CoinGecko
// -----------------------------------------------------------------------------

async function getCoinGeckoHeaders() {
  const apiKey = process.env.COINGECKO_API_KEY;

  const headers = {
    accept: "application/json",
  };

  // CoinGecko can currently be tested using public/free access.
  // If a Demo/API key is added later, automatically use it.
  if (apiKey) {
    headers["x-cg-demo-api-key"] = apiKey;
  }

  return headers;
}

async function testCoinGecko() {
  const headers = await getCoinGeckoHeaders();

  const response = await fetch(`${COINGECKO_BASE_URL}/ping`, {
    headers,
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `CoinGecko returned ${response.status}: ${text}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("CoinGecko returned invalid JSON");
  }

  return {
    ok: true,
    authenticated: Boolean(process.env.COINGECKO_API_KEY),
    response: data,
  };
}

async function testCoinGeckoHistory() {
  const headers = await getCoinGeckoHeaders();

  const url =
    `${COINGECKO_BASE_URL}/coins/bitcoin/market_chart` +
    "?vs_currency=usd" +
    "&days=7";

  const response = await fetch(url, {
    headers,
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `CoinGecko history returned ${response.status}: ${text}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "CoinGecko history returned invalid JSON"
    );
  }

  return {
    ok: true,
    authenticated: Boolean(process.env.COINGECKO_API_KEY),
    response: data,
  };
}

// -----------------------------------------------------------------------------
// API-Ninjas
// -----------------------------------------------------------------------------

function getApiNinjasApiKey() {
  return (
    process.env.API_NINJA_API_KEY ||
    process.env.API_NINJAS_API_KEY ||
    process.env.API_NINJA_APIKEY
  );
}

async function testApiNinjasMetal(name) {
  const apiKey = getApiNinjasApiKey();

  if (!apiKey) {
    throw new Error(
      "API_NINJA_API_KEY, API_NINJAS_API_KEY, or API_NINJA_APIKEY is not set"
    );
  }

  const url =
    `${API_NINJAS_BASE_URL}/commodityprice` +
    `?name=${encodeURIComponent(name)}`;

  const response = await fetch(url, {
    headers: {
      "X-Api-Key": apiKey,
      accept: "application/json",
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `API-Ninjas ${name} returned ${response.status}: ${text}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `API-Ninjas ${name} returned invalid JSON`
    );
  }

  return {
    ok: true,
    response: data,
  };
}

// -----------------------------------------------------------------------------
// API-Ninjas historical data
// -----------------------------------------------------------------------------

async function testApiNinjasHistorical(name, period = "1h") {
  const apiKey = getApiNinjasApiKey();

  if (!apiKey) {
    throw new Error(
      "API_NINJA_API_KEY, API_NINJAS_API_KEY, or API_NINJA_APIKEY is not set"
    );
  }

  const now = Math.floor(Date.now() / 1000);

  // Test a 24-hour historical window.
  const start = now - 24 * 60 * 60;
  const end = now;

  const params = new URLSearchParams({
    name,
    period,
    start: String(start),
    end: String(end),
  });

  const url =
    `${API_NINJAS_BASE_URL}/commoditypricehistorical?${params}`;

  const response = await fetch(url, {
    headers: {
      "X-Api-Key": apiKey,
      accept: "application/json",
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `API-Ninjas ${name} historical returned ${response.status}: ${text}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `API-Ninjas ${name} historical returned invalid JSON`
    );
  }

  return {
    ok: true,
    response: data,
    period,
    start,
    end,
  };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function run() {
  console.log("=================================");
  console.log("Market Data Engine connectivity");
  console.log("=================================");

  let failed = false;

  // ---------------------------------------------------------------------------
  // Firebase
  // ---------------------------------------------------------------------------

  try {
    const result = await testFirebase();

    console.log("\n✓ Firebase");
    console.log(`  Connected: ${result.ok}`);
    console.log(
      `  Health document exists: ${result.healthDocumentExists}`
    );
  } catch (error) {
    failed = true;

    console.error("\n✗ Firebase");
    console.error(`  ${error.message}`);
  }

  // ---------------------------------------------------------------------------
  // CoinGecko connectivity
  // ---------------------------------------------------------------------------

  try {
    const result = await testCoinGecko();

    console.log("\n✓ CoinGecko");
    console.log(
      `  Authentication: ${
        result.authenticated ? "API key" : "public/free"
      }`
    );
    console.log(`  Connected: ${result.ok}`);
    console.log(
      `  Response: ${JSON.stringify(result.response)}`
    );
  } catch (error) {
    failed = true;

    console.error("\n✗ CoinGecko");
    console.error(`  ${error.message}`);
  }

  // ---------------------------------------------------------------------------
  // CoinGecko BTC historical data
  // ---------------------------------------------------------------------------

  try {
    const result = await testCoinGeckoHistory();
    const data = result.response;

    console.log("\n✓ CoinGecko BTC historical data");
    console.log(
      `  Authentication: ${
        result.authenticated ? "API key" : "public/free"
      }`
    );

    console.log(
      `  Prices: ${data.prices?.length ?? 0}`
    );

    console.log(
      `  Market caps: ${data.market_caps?.length ?? 0}`
    );

    console.log(
      `  Volumes: ${data.total_volumes?.length ?? 0}`
    );

    if (data.prices?.length) {
      console.log("  First price:", data.prices[0]);
      console.log("  Last price:", data.prices[data.prices.length - 1]);
    }

    if (data.market_caps?.length) {
      console.log(
        "  First market cap:",
        data.market_caps[0]
      );

      console.log(
        "  Last market cap:",
        data.market_caps[data.market_caps.length - 1]
      );
    }

    if (data.total_volumes?.length) {
      console.log(
        "  First volume:",
        data.total_volumes[0]
      );

      console.log(
        "  Last volume:",
        data.total_volumes[data.total_volumes.length - 1]
      );
    }
  } catch (error) {
    failed = true;

    console.error("\n✗ CoinGecko BTC historical data");
    console.error(`  ${error.message}`);
  }

  // ---------------------------------------------------------------------------
  // API-Ninjas Gold spot
  // ---------------------------------------------------------------------------

  try {
    const result = await testApiNinjasMetal("gold");

    console.log("\n✓ API-Ninjas Gold");
    console.log(`  Connected: ${result.ok}`);
    console.log(
      `  Response: ${JSON.stringify(result.response)}`
    );
  } catch (error) {
    failed = true;

    console.error("\n✗ API-Ninjas Gold");
    console.error(`  ${error.message}`);
  }

  // ---------------------------------------------------------------------------
  // API-Ninjas Silver spot
  // ---------------------------------------------------------------------------

  try {
    const result = await testApiNinjasMetal("silver");

    console.log("\n✓ API-Ninjas Silver");
    console.log(`  Connected: ${result.ok}`);
    console.log(
      `  Response: ${JSON.stringify(result.response)}`
    );
  } catch (error) {
    failed = true;

    console.error("\n✗ API-Ninjas Silver");
    console.error(`  ${error.message}`);
  }

  // ---------------------------------------------------------------------------
  // API-Ninjas Gold historical
  // ---------------------------------------------------------------------------

  try {
    const result = await testApiNinjasHistorical(
      "gold",
      "1h"
    );

    const data = Array.isArray(result.response)
      ? result.response
      : [];

    console.log("\n✓ API-Ninjas Gold historical");
    console.log(`  Period: ${result.period}`);
    console.log(`  Points: ${data.length}`);

    if (data.length) {
      console.log("  First point:", data[0]);
      console.log("  Last point:", data[data.length - 1]);
    }
  } catch (error) {
    failed = true;

    console.error("\n✗ API-Ninjas Gold historical");
    console.error(`  ${error.message}`);
  }

  // ---------------------------------------------------------------------------
  // API-Ninjas Silver historical
  // ---------------------------------------------------------------------------

  try {
    const result = await testApiNinjasHistorical(
      "silver",
      "1h"
    );

    const data = Array.isArray(result.response)
      ? result.response
      : [];

    console.log("\n✓ API-Ninjas Silver historical");
    console.log(`  Period: ${result.period}`);
    console.log(`  Points: ${data.length}`);

    if (data.length) {
      console.log("  First point:", data[0]);
      console.log("  Last point:", data[data.length - 1]);
    }
  } catch (error) {
    failed = true;

    console.error("\n✗ API-Ninjas Silver historical");
    console.error(`  ${error.message}`);
  }

  // ---------------------------------------------------------------------------
  // Final result
  // ---------------------------------------------------------------------------

  console.log("\n=================================");

  if (failed) {
    console.error("Connectivity test FAILED");
    process.exitCode = 1;
    return;
  }

  console.log("All connectivity tests passed.");
}

// -----------------------------------------------------------------------------
// Startup
// -----------------------------------------------------------------------------

run().catch((error) => {
  console.error("\nFatal startup error:");
  console.error(error);
  process.exitCode = 1;
});