import "dotenv/config";

import {
  ingestCrypto,
  backfillCrypto,
} from "./jobs/crypto.job.js";

import {
  ingestMetals,
  backfillMetals,
} from "./jobs/metals.job.js";

const INTERVAL_MS =
  15 * 60 * 1000;

let running = false;
let backfillComplete = false;

/**
 * Historical backfill.
 *
 * This is NOT performed blindly on every startup.
 *
 * Each asset checks Firebase first.
 */
async function runBackfill() {
  console.log(
    "\n================================="
  );

  console.log(
    "Historical Backfill"
  );

  console.log(
    "================================="
  );

  const startedAt = Date.now();

  try {
    console.log(
      "[ backfill ] Checking existing crypto history..."
    );

    await backfillCrypto();

    console.log(
      "\n[ backfill ] Checking existing metal history..."
    );

    await backfillMetals();

    const duration =
      Date.now() - startedAt;

    console.log(
      `\n[ backfill ] Complete in ${(
        duration / 1000
      ).toFixed(2)}s`
    );

    backfillComplete = true;
  } catch (error) {
    console.error(
      "[ backfill ] Failed:"
    );

    if (error.response?.data) {
      console.error(
        error.response.data
      );
    } else {
      console.error(error);
    }
  }
}

/**
 * Normal live ingestion.
 */
async function runIngestion() {
  if (running) {
    console.log(
      "\n[ scheduler ] Previous ingestion is still running. Skipping this cycle."
    );

    return;
  }

  running = true;

  const startedAt = Date.now();

  console.log(
    "\n================================="
  );

  console.log(
    "Market Data Engine"
  );

  console.log(
    "================================="
  );

  console.log(
    `[ scheduler ] Ingestion started: ${new Date().toISOString()}`
  );

  try {
    await ingestCrypto();

    await ingestMetals();

    const duration =
      Date.now() - startedAt;

    console.log(
      "\n================================="
    );

    console.log(
      "Ingestion complete."
    );

    console.log(
      `[ scheduler ] Duration: ${(
        duration / 1000
      ).toFixed(2)}s`
    );

    console.log(
      `[ scheduler ] Next run: ${new Date(
        Date.now() +
          INTERVAL_MS
      ).toISOString()}`
    );

    console.log(
      "================================="
    );
  } catch (error) {
    console.error(
      "\n================================="
    );

    console.error(
      "Ingestion failed:"
    );

    console.error(error);

    console.error(
      "================================="
    );
  } finally {
    running = false;
  }
}

/**
 * Application startup.
 */
async function start() {
  console.log(
    "================================="
  );

  console.log(
    "Market Data Engine"
  );

  console.log(
    "================================="
  );

  console.log(
    `[ scheduler ] Interval: ${
      INTERVAL_MS / 1000
    } seconds`
  );

  /*
   * Check historical coverage.
   *
   * If data already exists, this should finish
   * very quickly and NOT download 365 days again.
   */
  await runBackfill();

  if (!backfillComplete) {
    console.error(
      "[ scheduler ] Backfill failed. Live ingestion will not start."
    );

    return;
  }

  /*
   * Immediately collect the newest data.
   */
  await runIngestion();

  /*
   * Continue on schedule.
   */
  setInterval(
    async () => {
      await runIngestion();
    },
    INTERVAL_MS
  );
}

start().catch((error) => {
  console.error(
    "\nFatal startup error:"
  );

  console.error(error);

  process.exitCode = 1;
});