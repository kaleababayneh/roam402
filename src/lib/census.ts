/**
 * src/lib/census.ts — cached access to the Agents-Trust census.
 *
 * The native trust endpoints previously fetched the full leaderboard
 * (2,400+ rows) from the public API on EVERY paid request — a second of
 * handler latency and a hard availability dependency. This module caches
 * per isolate for TTL_MS and serves stale on upstream failure: faster,
 * and /trust keeps answering through an agents-trust outage.
 */

const API = "https://api.agents-trust.ai";
const TTL_MS = 5 * 60 * 1000;

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

export async function censusRows(): Promise<CensusResult> {
  const fresh = cache && Date.now() - cache.at < TTL_MS;
  if (!fresh) {
    try {
      const res = await fetch(`${API}/q/leaderboard`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`census ${res.status}`);
      const body = (await res.json()) as { data?: CensusRow[] };
      cache = { at: Date.now(), rows: body.data ?? [] };
    } catch (err) {
      if (!cache) throw err; // no snapshot to fall back to
      return { rows: cache.rows, stale: true, fetchedAt: new Date(cache.at).toISOString() };
    }
  }
  const state = cache as CacheState;
  return { rows: state.rows, stale: false, fetchedAt: new Date(state.at).toISOString() };
}

/** Test hook — resets the isolate cache. */
export function _resetCensusCache(): void {
  cache = null;
}
