/**
 * src/lib/census.ts — cached access to the Agents-Trust census.
 *
 * The native trust endpoints previously fetched the full leaderboard
 * (2,400+ rows) from the public API on EVERY paid request — a second of
 * handler latency and a hard availability dependency. Two-layer defence:
 *   1. isolate memory, TTL 5 min — the fast path;
 *   2. KV snapshot (last good fetch, 7-day expiry) — survives isolate
 *      recycling, so a COLD isolate can still answer through a full
 *      agents-trust outage. Stale responses are flagged to the caller.
 */

const API = "https://api.agents-trust.ai";
const TTL_MS = 5 * 60 * 1000;
const KV_KEY = "census:snapshot";
const KV_TTL_S = 7 * 24 * 3600; // beyond a week stale, "trust data" is a lie

export interface CensusRow {
  domain?: string;
  display_name?: string;
  trust_tier?: string;
  trust_score?: string | number | null;
  verified_volume_usd_total?: string | null;
  verified_tx_total?: string | null;
  first_settlement_at?: string | null;
  [k: string]: unknown;
}

interface CacheState {
  at: number;
  rows: CensusRow[];
}

let cache: CacheState | null = null;

export interface CensusResult {
  rows: CensusRow[];
  /** True when upstream failed and we served the previous snapshot. */
  stale: boolean;
  fetchedAt: string;
}

const asResult = (state: CacheState, stale: boolean): CensusResult => ({
  rows: state.rows,
  stale,
  fetchedAt: new Date(state.at).toISOString(),
});

export async function censusRows(kv?: KVNamespace): Promise<CensusResult> {
  if (cache && Date.now() - cache.at < TTL_MS) return asResult(cache, false);
  try {
    const res = await fetch(`${API}/q/leaderboard`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`census ${res.status}`);
    const body = (await res.json()) as { data?: CensusRow[] };
    cache = { at: Date.now(), rows: body.data ?? [] };
    // Snapshot for cold isolates; a lost put only costs outage resilience.
    await kv?.put(KV_KEY, JSON.stringify(cache), { expirationTtl: KV_TTL_S }).catch(() => {});
    return asResult(cache, false);
  } catch (err) {
    if (cache) return asResult(cache, true);
    const snapshot = await kv?.get<CacheState>(KV_KEY, "json").catch(() => null);
    if (snapshot?.rows) {
      cache = snapshot; // seed memory: TTL is already spent, so every later
      return asResult(snapshot, true); // request retries upstream, serves stale
    }
    throw err;
  }
}

/** Test hook — resets the isolate cache. */
export function _resetCensusCache(): void {
  cache = null;
}
