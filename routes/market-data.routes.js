import express from "express";
import {
  getCandles,
  getLatestCandle,
} from "../repositories/market-data.repository.js";

const router = express.Router();

/**
 * GET /api/market-data/:symbol
 *n
 * Example:
 *
 * /api/market-data/BTC?start=2026-08-01&end=2026-08-21
 */
router.get("/:symbol", async (req, res) => {
  try {
    const symbol = String(req.params.symbol)
      .trim()
      .toUpperCase();

    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        error: "start and end are required",
      });
    }

    const candles = await getCandles(
      symbol,
      start,
      end
    );

    return res.json({
      symbol,
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
 */
router.get("/:symbol/latest", async (req, res) => {
  try {
    const symbol = String(req.params.symbol)
      .trim()
      .toUpperCase();

    const candle = await getLatestCandle(symbol);

    return res.json({
      symbol,
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