import { db } from "../config/firebase.js";
import { ingestAssetMarketCap } from "./assetmarketcap.runner.js";

const CHECK_EVERY_MS = 30 * 60 * 1000; // Firestore check only; NOT an HTTP request.
let started = false;

export function startAssetMarketCapScheduler() {
  if (started) return;
  started = true;
  
  const apiKey = process.env.ASSETMARKETCAP_API_KEY;
  if (!apiKey?.trim()) {
    console.warn("[assetmarketcap] Scheduler disabled: missing ASSETMARKETCAP_API_KEY.");
    return;
  }

  const run = async () => {
    try {
      await ingestAssetMarketCap({ db, apiKey });
    } catch (error) {
      // A Firestore failure must not stop the separate crypto/metals worker.
      console.error("[assetmarketcap] Firestore scheduling failed:", error?.message ?? error);
    }
  };

  // The durable Firestore request budget gates outbound calls, even on restart.
  void run();
  setInterval(() => void run(), CHECK_EVERY_MS);
  console.log("[assetmarketcap] Firestore-gated ingestion active (minimum 8h; max 100 attempts/month).");
}
