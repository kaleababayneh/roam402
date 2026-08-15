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

// ── Domain-level trust: one rich row from /q/trust_domain ───────────────────
// Joins the leaderboard mart (volume windows, buyer shape) with the trust-
// score mart (model version, pillars, flags, delivery test) on the CH-API
// side. Null row = endpoint missing/unknown domain → callers fall back to the
// leaderboard scan, so shipping order between the two workers cannot break
// /trust. Same two-layer cache defence as censusRows, keyed per domain.

export interface TrustDomainRow {
  entity_id?: string;
  seller_id?: string;
  display_name?: string | null;
  domain?: string | null;
  category?: string | null;
  trust_tier?: string | null;
  trust_score?: string | number | null;
  min_price_usd?: string | number | null;
  chains?: unknown;
  verified_volume_usd_total?: string | number | null;
  verified_tx_total?: string | number | null;
  verified_last_7d_volume?: string | number | null;
  verified_last_7d_tx?: string | number | null;
  verified_last_30d_volume?: string | number | null;
  verified_last_30d_tx?: string | number | null;
  verified_last_90d_volume?: string | number | null;
  verified_last_90d_tx?: string | number | null;
  first_settlement_at?: string | null;
  last_settlement_at?: string | null;
  repeat_buyers?: string | number | null;
  retained_30d_buyers?: string | number | null;
  top_payer_share?: string | number | null;
  self_trade_share?: string | number | null;
  /** '' when the seller is absent from the score mart (CH LEFT JOIN default —
   * treat every pillar/flag/delivery column as absent, not zero). */
  trust_row_entity_id?: string;
  trust_model_version?: string | null;
  n_pillars_present?: string | number | null;
  coverage_pct?: string | number | null;
  score_traction?: string | number | null;
  score_liveness?: string | number | null;
  score_identity?: string | number | null;
  flag_has_onchain?: number | boolean | null;
  flag_has_live?: number | boolean | null;
  flag_has_well_known?: number | boolean | null;
  flag_has_github?: number | boolean | null;
  flag_has_x_handle?: number | boolean | null;
  flag_is_erc8004?: number | boolean | null;
  flag_active_30d?: number | boolean | null;
  delivery_label?: string | null;
  delivery_tested_at?: string | null;
  delivery_quality_grade?: string | null;
  as_of?: string | null;
  [k: string]: unknown;
}

export interface TrustDomainResult {
  row: TrustDomainRow | null;
  stale: boolean;
}

const TRUST_TTL_MS = 5 * 60 * 1000;
const TRUST_KV_TTL_S = 7 * 24 * 3600;
const trustCache = new Map<string, { at: number; row: TrustDomainRow | null }>();

export async function trustDomain(domain: string, kv?: KVNamespace): Promise<TrustDomainResult> {
  const hit = trustCache.get(domain);
  if (hit && Date.now() - hit.at < TRUST_TTL_MS) return { row: hit.row, stale: false };
  try {
    const res = await fetch(`${API}/q/trust_domain?domain=${encodeURIComponent(domain)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) throw new Error(`trust_domain ${res.status}`);
    const body = (await res.json()) as { data?: TrustDomainRow[] };
    const row = body.data?.[0] ?? null;
    if (trustCache.size > 512) trustCache.clear(); // crude bound; entries are tiny
    trustCache.set(domain, { at: Date.now(), row });
    if (row) {
      await kv?.put(`census:trust:${domain}`, JSON.stringify(row), { expirationTtl: TRUST_KV_TTL_S }).catch(() => {});
    }
    return { row, stale: false };
  } catch {
    if (hit) return { row: hit.row, stale: true };
    const snap = await kv?.get<TrustDomainRow>(`census:trust:${domain}`, "json").catch(() => null);
    if (snap) return { row: snap, stale: true };
    return { row: null, stale: false }; // caller falls back to the leaderboard scan
  }
}

/** Test hook — resets the isolate cache. */
export function _resetCensusCache(): void {
  cache = null;
  trustCache.clear();
}
