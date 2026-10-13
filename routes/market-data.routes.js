
import express from "express";
import {
  getCandles,
  getLatestCandle,
} from "../repositories/market-data.repository.js";

const router = express.Router();

const SUPPORTED_SYMBOLS = ["BTC", "ETH", "XMR", "XAU", "XAG"];
const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP"];
const USD_ONLY_SYMBOLS = ["XAU", "XAG"];

/**
 * Normalize and validate market selection.
 */
function getMarketSelection(req) {
  const symbol = String(req.params.symbol || "")
    .trim()
    .toUpperCase();

  const currency = String(req.query.currency || "USD")
    .trim()
    .toUpperCase();

  if (!SUPPORTED_SYMBOLS.includes(symbol)) {
    return {
      error: `Unsupported market-data symbol: ${symbol}`,
    };
  }

  if (
    !SUPPORTED_CURRENCIES.includes(currency) ||
    (USD_ONLY_SYMBOLS.includes(symbol) && currency !== "USD")
  ) {
    return {
      error: `Unsupported currency ${currency} for ${symbol}`,
    };
  }

  return { symbol, currency };
}

/**
 * GET /api/market-data
 *
 * API discovery endpoint.
 */
router.get("/", (req, res) => {
  const markets = Object.fromEntries(
    SUPPORTED_SYMBOLS.map(symbol => [
      symbol,
      USD_ONLY_SYMBOLS.includes(symbol)
        ? ["USD"]
        : [...SUPPORTED_CURRENCIES],
    ])
  );

  return res.json({
    name: "Market Data API",
    status: "ok",
    markets,
    endpoints: {
      historical: {
        method: "GET",
        path: "/api/market-data/:symbol",
        parameters: {
          currency: "USD, EUR, GBP (optional; defaults to USD)",
          start: "ISO 8601 date or timestamp (required)",
          end: "ISO 8601 date or timestamp (required)",
        },
        example:
          "/api/market-data/BTC?currency=USD&start=2026-10-01&end=2026-10-13",
      },
      latest: {
        method: "GET",
        path: "/api/market-data/:symbol/latest",
        parameters: {
          currency: "USD, EUR, GBP (optional; defaults to USD)",
        },
        example:
          "/api/market-data/BTC/latest?currency=USD",
      },
    },
  });
});

/**
 * GET /api/market-data/:symbol
 *
 * Examples:
 *
 * /api/market-data/BTC?start=2026-10-01&end=2026-10-13
 *
 * /api/market-data/BTC?currency=EUR&start=2026-10-01&end=2026-10-13
 *
 * /api/market-data/ETH?currency=GBP&start=2026-10-01&end=2026-10-13
 */
router.get("/:symbol", async (req, res) => {
  try {
    const selection = getMarketSelection(req);

    if (selection.error) {
      return res.status(400).json({
        error: selection.error,
      });
    }

    const { symbol, currency } = selection;
    const { start, end } = req.query;

    if (
      typeof start !== "string" ||
      typeof end !== "string" ||
      !start.trim() ||
      !end.trim()
    ) {
      return res.status(400).json({
        error: "start and end are required",
      });
    }

    const startTimestamp = Date.parse(start);
    const endTimestamp = Date.parse(end);

    if (
      !Number.isFinite(startTimestamp) ||
      !Number.isFinite(endTimestamp) ||
      startTimestamp > endTimestamp
    ) {
      return res.status(400).json({
        error: "Invalid start or end date range",
      });
    }

    /**
     * Preserve existing repository argument order.
     */
    const candles = await getCandles(
      symbol,
      currency,
      startTimestamp,
      endTimestamp
    );

    return res.json({
      symbol,
      currency,
      start,
      end,
      count: candles.length,
      candles,
    });
  } catch (error) {
    console.error(
      "[market-data.api] Failed to get candles:",
      error
    );

    return res.status(500).json({
      error: "Failed to load market data",
      message: error.message,
    });
  }
});

/**
 * GET /api/market-data/:symbol/latest
 *
 * Examples:
 *
 * /api/market-data/BTC/latest
 * /api/market-data/BTC/latest?currency=EUR
 * /api/market-data/ETH/latest?currency=GBP
 */
router.get("/:symbol/latest", async (req, res) => {
  try {
    const selection = getMarketSelection(req);

    if (selection.error) {
      return res.status(400).json({
        error: selection.error,
      });
    }

    const { symbol, currency } = selection;

    const candle = await getLatestCandle(
      symbol,
      currency
    );

    return res.json({
      symbol,
      currency,
      candle,
    });
  } catch (error) {
    console.error(
      "[market-data.api] Failed to get latest candle:",
      error
    );

    return res.status(500).json({
      error: "Failed to load latest market data",
      message: error.message,
    });
  }
});

export default router;
