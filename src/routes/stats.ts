/**
 * src/routes/stats.ts — /api/challenge-stats (free, CORS-open).
 *
 * Aggregates the GoPlausible Bazaar discovery feed into per-merchant
 * challenge stats (resources, settles, est. USDC). Serves the Agents-Trust
 * scoreboard page and anyone else — open data, cached per isolate for
 * CACHE_MS so we never hammer the facilitator.
 */

import { Hono } from "hono";

const DISCOVERY_URL = "https://facilitator.goplausible.xyz/discovery/resources?limit=500";
const CACHE_MS = 5 * 60 * 1000;

interface MerchantStat {
  domain: string;
  resources: number;
  settles: number;
  verifies: number;
  estUsd: number;
}

interface ChallengeStats {
  fetchedAt: string;
  totalResources: number;
  totalSettles: number;
  totalEstUsd: number;
  merchants: MerchantStat[];
}

interface DiscoveryItem {
  resourceUrl?: string;
  settleCount?: number | string;
  verifyCount?: number | string;
  accepts?: { amount?: string; extra?: { decimals?: number } }[];
}

let cache: { at: number; stats: ChallengeStats } | null = null;

function aggregate(items: DiscoveryItem[]): ChallengeStats {
  const byDomain = new Map<string, MerchantStat>();
  for (const it of items) {
    let domain: string;
    try {
      domain = new URL(it.resourceUrl ?? "").hostname;
    } catch {
      continue;
    }
    const acc = it.accepts?.[0];
    const decimals = acc?.extra?.decimals ?? 6;
    const priceUsd = acc?.amount ? Number(acc.amount) / 10 ** decimals : 0;
    const settles = Number(it.settleCount ?? 0);

    const m = byDomain.get(domain) ?? { domain, resources: 0, settles: 0, verifies: 0, estUsd: 0 };
    m.resources += 1;
    m.settles += settles;
    m.verifies += Number(it.verifyCount ?? 0);
    m.estUsd += settles * priceUsd;
    byDomain.set(domain, m);
  }
  const merchants = [...byDomain.values()].sort((a, b) => b.estUsd - a.estUsd || b.settles - a.settles);
  return {
    fetchedAt: new Date().toISOString(),
    totalResources: items.length,
    totalSettles: merchants.reduce((s, m) => s + m.settles, 0),
    totalEstUsd: merchants.reduce((s, m) => s + m.estUsd, 0),
    merchants,
  };
}

export function mountStats(app: Hono): void {
  app.get("/api/challenge-stats", async (c) => {
    if (!cache || Date.now() - cache.at > CACHE_MS) {
      const res = await fetch(DISCOVERY_URL, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        if (cache) return c.json(cache.stats); // stale beats broken
        return c.json({ error: "discovery_unavailable" }, 502);
      }
      const body = (await res.json()) as { items?: DiscoveryItem[] };
      cache = { at: Date.now(), stats: aggregate(body.items ?? []) };
    }
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Cache-Control", "public, max-age=120");
    return c.json(cache.stats);
  });
}
