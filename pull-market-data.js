import "dotenv/config";

import { ingestCrypto, backfillCrypto } from "./jobs/crypto.job.js";
import { ingestMetals, backfillMetals } from "./jobs/metals.job.js";

const INTERVAL_MS = 30 * 60 * 1000;
let running = false;

async function runBackfill() {
  const startedAt = Date.now();
  console.log("\n[backfill] Checking history...");

  try {
    await backfillCrypto();
    await backfillMetals();

    console.log(
      `[backfill] Complete in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`
    );
    return true;
  } catch (error) {
    console.error("[backfill] Failed:", error.response?.data || error);
    return false;
  }
}

async function runIngestion() {
  if (running) {
    console.log("[scheduler] Previous ingestion still running; skipping.");
    return;
  }

  running = true;
  const startedAt = Date.now();

  try {
    console.log(
      `[scheduler] Ingestion started: ${new Date().toISOString()}`
    );

    await ingestCrypto();
    await ingestMetals();

    console.log(
      `[scheduler] Complete in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`
    );
    console.log(
      `[scheduler] Next run: ${new Date(Date.now() + INTERVAL_MS).toISOString()}`
    );
  } catch (error) {
    console.error("[scheduler] Ingestion failed:", error);
  } finally {
    running = false;
  }
}

async function start() {
  console.log(
    `[scheduler] Market Data Engine | Interval: ${INTERVAL_MS / 1000}s`
  );

  if (!(await runBackfill())) {
    console.error("[scheduler] Backfill failed. Live ingestion stopped.");
    return;
  }

  await runIngestion();
  setInterval(runIngestion, INTERVAL_MS);
}

start().catch((error) => {
  console.error("[fatal] Startup error:", error);
  process.exitCode = 1;
});
