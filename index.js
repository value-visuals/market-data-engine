import "dotenv/config";

import { ingestCrypto } from "./jobs/crypto.job.js";
import { ingestMetals } from "./jobs/metals.job.js";

async function run() {
  console.log("=================================");
  console.log("Market Data Engine");
  console.log("=================================");

  await ingestCrypto({
    days: 7,
    symbols: ["BTC", "ETH"],
  });

  await ingestMetals({
    days: 7,
    period: "1h",
  });

  console.log("\n=================================");
  console.log("Ingestion complete.");
  console.log("=================================");
}

run().catch((error) => {
  console.error("\nIngestion failed:");
  console.error(error);
  process.exitCode = 1;
});