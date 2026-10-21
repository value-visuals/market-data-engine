import { randomUUID } from "node:crypto";
import { fetchAssetMarketCap } from "../providers/assetmarketcap.provider.js";
import { normalizeAssetMarketCapSnapshot } from "../normalizers/assetmarketcap.normalizer.js";
import { createAssetMarketCapRepository } from "../repositories/assetmarketcap.repository.js";

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

// Exported for isolated tests, without importing the Firebase app or making HTTP calls.
export async function ingestAssetMarketCap({
  db, apiKey, fetcher = fetchAssetMarketCap, now = () => Date.now(),
  owner = randomUUID(), logger = console, refreshMs = EIGHT_HOURS_MS,
  monthlyBudget = 100,
}) {
  if (!apiKey?.trim()) return { status: "disabled", reason: "missing_api_key" };
  // Configuration cannot accidentally exceed 3 requests/day or the safety budget.
  const safeRefreshMs = Math.max(EIGHT_HOURS_MS, refreshMs);
  const safeBudget = Math.max(1, Math.min(100, Math.floor(monthlyBudget)));
  const repo = createAssetMarketCapRepository(db);
  const nowMs = now();
  const claim = await repo.claim({ owner, nowMs, refreshMs: safeRefreshMs, monthlyBudget: safeBudget });
  if (!claim.claimed) return { status: "skipped", reason: claim.reason };

  try {
    const raw = await fetcher({ apiKey, nowMs });
    const snapshot = normalizeAssetMarketCapSnapshot(raw, new Date(now()).toISOString());
    const committed = await repo.saveSuccess({ owner, snapshot });
    if (!committed) {
      logger.warn("[assetmarketcap] Lease lost while saving; not publishing an older snapshot.");
      return { status: "skipped", reason: "lease_lost" };
    }
    logger.info(`[assetmarketcap] Stored ${snapshot.count} assets; asOf=${snapshot.asOf ?? "unknown"}; ` +
      `attempt ${claim.attemptsThisMonth}/${safeBudget} (${claim.month}).`);
    return { status: "success", count: snapshot.count, fetchedAt: snapshot.fetchedAt };
  } catch (error) {
    const code = Number.isInteger(error?.status) ? `HTTP_${error.status}` : "FETCH_OR_VALIDATION";
    await repo.saveFailure({ owner, nowMs: now(), code, retryAfterMs: error?.retryAfterMs ?? 0 });
    logger.warn(`[assetmarketcap] ${code}; retaining last successful Firestore snapshot. ` +
      "No automatic HTTP retry will occur.");
    return { status: "failed", code };
  }
}
