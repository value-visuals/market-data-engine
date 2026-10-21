// Firestore transaction-based rate budget + distributed ingestion lock.
// A request is debited BEFORE hitting the provider, including failed/timeout attempts.

const CONTROL_COLLECTION = "marketCapIngestion";
const SNAPSHOT_COLLECTION = "marketCapSnapshots";
export const SOURCE_ID = "assetmarketcap";
const LEASE_MS = 120_000;

export function createAssetMarketCapRepository(db) {
  const stateRef = db.collection(CONTROL_COLLECTION).doc(SOURCE_ID);
  const snapshotRef = db.collection(SNAPSHOT_COLLECTION).doc(SOURCE_ID);

  return {
    async claim({ owner, nowMs, refreshMs, monthlyBudget }) {
      return db.runTransaction(async (transaction) => {
        const state = (await transaction.get(stateRef)).data() ?? {};
        const month = new Date(nowMs).toISOString().slice(0, 7);
        const used = state.usageMonth === month ? Number(state.attemptsThisMonth) || 0 : 0;

        if (Number(state.leaseExpiresAtMs) > nowMs) return { claimed: false, reason: "another_worker" };
        if (Number(state.nextAttemptAtMs) > nowMs) return { claimed: false, reason: "not_due" };
        if (used >= monthlyBudget) return { claimed: false, reason: "monthly_budget" };

        transaction.set(stateRef, {
          source: "AssetMarketCap", usageMonth: month, attemptsThisMonth: used + 1,
          lastAttemptAt: new Date(nowMs).toISOString(),
          nextAttemptAtMs: nowMs + refreshMs,
          leaseOwner: owner,
          leaseExpiresAtMs: nowMs + LEASE_MS,
          lastStatus: "fetching",
        }, { merge: true });
        return { claimed: true, attemptsThisMonth: used + 1, month };
      });
    },

    async saveSuccess({ owner, snapshot }) {
      return db.runTransaction(async (transaction) => {
        const state = (await transaction.get(stateRef)).data() ?? {};
        if (state.leaseOwner !== owner) return false;
        transaction.set(snapshotRef, snapshot);
        transaction.set(stateRef, {
          leaseOwner: null, leaseExpiresAtMs: 0,
          lastSuccessAt: snapshot.fetchedAt,
          lastStatus: "success", lastErrorCode: null,
          consecutiveFailures: 0,
        }, { merge: true });
        return true;
      });
    },

    async saveFailure({ owner, nowMs, code, retryAfterMs = 0 }) {
      return db.runTransaction(async (transaction) => {
        const state = (await transaction.get(stateRef)).data() ?? {};
        if (state.leaseOwner !== owner) return false;
        transaction.set(stateRef, {
          leaseOwner: null, leaseExpiresAtMs: 0,
          lastFailureAt: new Date(nowMs).toISOString(),
          lastErrorCode: String(code).slice(0, 40), lastStatus: "failed",
          consecutiveFailures: (Number(state.consecutiveFailures) || 0) + 1,
          nextAttemptAtMs: Math.max(Number(state.nextAttemptAtMs) || 0, nowMs + retryAfterMs),
        }, { merge: true });
        // Do NOT modify the previously successful snapshot on any failure.
        return true;
      });
    },

    async readSnapshot() {
      const snapshot = await snapshotRef.get();
      return snapshot.exists ? snapshot.data() : null;
    },

    async readState() {
      const state = await stateRef.get();
      return state.exists ? state.data() : null;
    },
  };
}
