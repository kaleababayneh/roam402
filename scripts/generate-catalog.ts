/**
 * scripts/generate-catalog.ts — build catalog/routes.json from the
 * Agents-Trust census, via the PUBLIC API only (no repo coupling).
 *
 *   pnpm catalog:generate            # writes catalog/routes.json
 *
 * Selection policy (launch quality over quantity):
 *   - service trust tier ≥ Established (Corroborated first)
 *   - services ranked by 30d settled volume, then all-time
 *   - endpoints: GET, priced > 0, ≤ PRICE_CAP, live-probed, Base-side
 *   - ≤ MAX_PER_SERVICE routes per service, ≤ MAX_ROUTES total
 *
 * The output is committed: deploys are reproducible, diffs are reviewable.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.agents-trust.ai";
const MAX_ROUTES = 2500;
const MAX_PER_SERVICE = 5;
const PRICE_CAP_USD = 1.0;
const TIER_RANK: Record<string, number> = { Corroborated: 3, Established: 2, Emerging: 1 };
/** Proven demand qualifies regardless of tier — buyers vote with USDC. */
const VOLUME_QUALIFY_30D_USD = 100;

// Margin model — MUST match src/pricing.ts (duplicated here so the script
// stays runnable standalone; the committed output is the contract).
// TRACTION PRICING: zero margin — charge exactly the origin price.
const roamPriceUsd = (origin: number): number =>
  Math.ceil(origin * 1_000_000) / 1_000_000;

interface LbRow {
  entity_id: string;
  domain: string;
  display_name: string;
  trust_tier: string;
  category: string;
  verified_volume_usd_total: string | null;
  verified_last_30d_volume: string | null;
}

interface RawEndpoint {
  url?: string;
  catalog_method?: string;
  price_usd?: number | null;
  is_live?: boolean | null;
  pay_to?: string | null;
  chain?: string | null;
  description?: string | null;
}

interface WrappedRoute {
  slug: string;
  service: string;
  tier: string;
  category: string;
  method: "GET" | "POST";
  originUrl: string;
  originPriceUsd: number;
  roamPriceUsd: number;
  description: string;
}

const num = (s: string | null): number => {
  const n = Number.parseFloat(s ?? "");
  return Number.isFinite(n) ? n : 0;
};

async function q<T>(path: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
      const body = (await res.json()) as { data: T };
      return body.data;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}

function isBaseSide(ep: RawEndpoint): boolean {
  const c = (ep.chain ?? "").toLowerCase();
  if (c === "base" || c === "eip155:8453") return true;
  return c === "" && (ep.pay_to ?? "").startsWith("0x"); // EVM pay_to, chain unlabelled
}

function slugify(domain: string, url: string, taken: Set<string>): string {
  const svc = domain.replace(/\.[a-z]+$/i, "").replace(/[^a-z0-9]+/gi, "");
  const tail =
    new URL(url).pathname.split("/").filter(Boolean).slice(-2).join("-").replace(/[^a-z0-9-]+/gi, "") || "root";
  // Truncate the BASE, then append the counter OUTSIDE the slice — slicing
  // the counter off left the slug unchanged and this loop spinning forever
  // (32 CPU-hours of proof) once 48-char names collided at full coverage.
  const base = `${svc}-${tail}`.toLowerCase().slice(0, 48);
  let slug = base;
  let i = 2;
  while (taken.has(slug)) slug = `${base.slice(0, 44)}-${i++}`;
  taken.add(slug);
  return slug;
}

function describe(ep: RawEndpoint, row: LbRow): string {
  const what = (ep.description ?? "").trim() || `${(ep.catalog_method ?? "GET").toUpperCase()} ${new URL(ep.url!).pathname} on ${row.display_name}`;
  const base = what.length > 140 ? `${what.slice(0, 137)}…` : what;
  return `${base} · via Roam402 from ${row.domain} (${row.trust_tier} on Agents-Trust) · pay USDC on Algorand, fulfilled on Base, dual-chain receipts.`;
}

/**
 * One service's pickable endpoints: fetch detail, https-normalise, dedupe by
 * host+path (method-agnostic — catalogs carry http/https and null-method
 * duplicates of the same interface; an explicitly-declared method beats a
 * null-method row, then the cheaper price wins), filter to payable GET/POST
 * under the cap, rank real interfaces first. Pure per-service — safe to run
 * concurrently. null = service unusable (fetch/parse failure or no detail).
 */
async function harvestPicks(row: LbRow): Promise<RawEndpoint[] | null> {
  let detail: { endpoints: string | null };
  try {
    const rowsD = await q<{ endpoints: string | null }[]>(`/q/service_detail?id=${row.entity_id}`);
    const first = rowsD[0];
    if (!first) return null;
    detail = first;
  } catch {
    return null;
  }

  let eps: RawEndpoint[];
  try {
    eps = detail.endpoints ? (JSON.parse(detail.endpoints) as RawEndpoint[]) : [];
  } catch {
    return null;
  }

  const seen = new Map<string, RawEndpoint>();
  for (const ep of eps) {
    if (!ep.url) continue;
    const url = ep.url.replace(/^http:\/\//, "https://");
    let key: string;
    try {
      const u = new URL(url);
      key = `${u.host}${u.pathname}`;
    } catch {
      continue;
    }
    const prev = seen.get(key);
    const better =
      !prev ||
      (!!ep.catalog_method && !prev.catalog_method) ||
      (!!ep.catalog_method === !!prev.catalog_method &&
        (ep.price_usd ?? Infinity) < (prev.price_usd ?? Infinity));
    if (better) seen.set(key, { ...ep, url });
  }
  return [...seen.values()]
    .filter(
      (ep) =>
        ["GET", "POST"].includes((ep.catalog_method ?? "GET").toUpperCase()) &&
        typeof ep.price_usd === "number" &&
        ep.price_usd > 0 &&
        ep.price_usd <= PRICE_CAP_USD &&
        ep.is_live === true &&
        isBaseSide(ep)
    )
    .sort(
      (a, b) =>
        Number(!!b.catalog_method) - Number(!!a.catalog_method) ||
        (b.price_usd ?? 0) - (a.price_usd ?? 0)
    )
    .slice(0, MAX_PER_SERVICE);
}

async function main(): Promise<void> {
  console.log("→ leaderboard…");
  const rows = await q<LbRow[]>("/q/leaderboard");

  const candidates = rows
    .filter((r) => TIER_RANK[r.trust_tier] !== undefined || num(r.verified_last_30d_volume) >= VOLUME_QUALIFY_30D_USD)
    .sort(
      (a, b) =>
        num(b.verified_last_30d_volume) - num(a.verified_last_30d_volume) ||
        num(b.verified_volume_usd_total) - num(a.verified_volume_usd_total)
    );
  console.log(`  ${candidates.length} services at Established+`);

  // Detail fetches are independent per service — a worker pool turns ~950
  // sequential round-trips (10-25 min) into ~2 min. Everything stateful
  // (slug set, MAX_ROUTES cap, census-rank order) stays in the sequential
  // assembly pass below.
  const HARVEST_CONCURRENCY = 10;
  const harvested: (RawEndpoint[] | null)[] = new Array(candidates.length).fill(null);
  let next = 0;
  let fetched = 0;
  await Promise.all(
    Array.from({ length: HARVEST_CONCURRENCY }, async () => {
      while (true) {
        const i = next++;
        if (i >= candidates.length) return;
        harvested[i] = await harvestPicks(candidates[i]!);
        if (++fetched % 100 === 0) console.log(`  …${fetched}/${candidates.length} service details`);
      }
    })
  );

  const routes: WrappedRoute[] = [];
  const taken = new Set<string>();

  for (const [ci, row] of candidates.entries()) {
    if (routes.length >= MAX_ROUTES) break;
    const picked = harvested[ci];
    if (!picked) continue;

    // Origins often reuse one service-level blurb across every endpoint;
    // a wrong description is worse than a plain one. Keep the blurb for the
    // FIRST endpoint that uses it, name the rest by what they are.
    const descCount = new Map<string, number>();
    for (const ep of picked) {
      const d = (ep.description ?? "").trim();
      if (d) descCount.set(d, (descCount.get(d) ?? 0) + 1);
    }
    const usedDesc = new Set<string>();
    for (const ep of picked) {
      if (routes.length >= MAX_ROUTES) break;
      const d = (ep.description ?? "").trim();
      const dup = d && (descCount.get(d) ?? 0) > 1 && usedDesc.has(d);
      if (d) usedDesc.add(d);
      const epForDesc = dup ? { ...ep, description: null } : ep;
      routes.push({
        slug: slugify(row.domain, ep.url!, taken),
        service: row.domain,
        tier: row.trust_tier,
        category: row.category ?? "other",
        method: (ep.catalog_method ?? "GET").toUpperCase() === "POST" ? "POST" : "GET",
        originUrl: ep.url!,
        originPriceUsd: ep.price_usd!,
        roamPriceUsd: roamPriceUsd(ep.price_usd!),
        description: describe(epForDesc, row),
      });
    }

  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: "agents-trust.ai public API (q/leaderboard + q/service_detail)",
    routes,
  };
  // Aggregate review report — at this scale you review the shape, not lines.
  const byTier = new Map<string, number>();
  const byCat = new Map<string, number>();
  const services = new Set<string>();
  for (const r of routes) {
    byTier.set(r.tier, (byTier.get(r.tier) ?? 0) + 1);
    byCat.set(r.category, (byCat.get(r.category) ?? 0) + 1);
    services.add(r.service);
  }
  console.log(`services: ${services.size} · routes: ${routes.length}`);
  console.log("by tier:", Object.fromEntries([...byTier.entries()].sort((a, b) => b[1] - a[1])));
  console.log("by category:", Object.fromEntries([...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)));

  const here = dirname(fileURLToPath(import.meta.url));
  const dest = join(here, "..", "catalog", "routes.json");
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`✓ wrote ${routes.length} routes → catalog/routes.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
