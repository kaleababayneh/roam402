/**
 * src/routes/free.ts — unpaid surface: health + the catalog funnel.
 *
 * /catalog is deliberately free: it is how agents discover what they can
 * buy here. Selling the menu would starve the restaurant.
 */

import { Hono } from "hono";
import type { AppEnv } from "../lib/appEnv";
import type { Config } from "../config";
import { catalog } from "../catalog";
import { NATIVE_ROUTES } from "./native";
import { usdString } from "../pricing";
import { routeLabel, searchText } from "../lib/routeText";
import { getHealthSummary } from "../fulfillment/health";
import { openTripCount } from "../fulfillment/breaker";

/**
 * Catalog selection — filtering and paging live here because the callers are
 * agents with finite context windows.
 *
 * The whole route table is ~1MB of JSON (roughly 250k tokens); even the old
 * 500-route cap was ~184KB / ~46k tokens, which is a quarter of a large
 * context window spent before the agent has done anything. So:
 *   - responses are PAGED by default (DEFAULT_LIMIT), with `total` and `next`
 *     so nothing is silently unreachable — the old cap had no offset at all;
 *   - descriptions drop the ~122-char tail every route repeats verbatim (it is
 *     already stated once in `how`/`network`/`asset` above);
 *   - filters exist for the dimensions an agent actually narrows on, so it can
 *     ask a question instead of downloading the table.
 * `limit=all` remains available for a deliberate full dump.
 */
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 500;

export interface CatalogQuery {
  q?: string;
  category?: string;
  service?: string;
  tier?: string;
  method?: string;
  maxPrice?: number;
  limit?: number | "all";
  offset?: number;
}

interface CatalogRow {
  path: string;
  method: string;
  price: string;
  service: string;
  trust_tier: string;
  category: string;
  description: string;
}

function allRows(): CatalogRow[] {
  return catalog.routes.map((r) => ({
    path: `/r/${r.slug}`,
    method: r.method,
    price: usdString(r.roamPriceUsd),
    service: r.service,
    trust_tier: r.tier,
    category: r.category ?? "other",
    // Distinct part only — see lib/routeText.ts for why the tail is dropped.
    description: routeLabel(r.description ?? "", r.slug),
  }));
}

/** path → lowercase match text, built once per isolate. */
const searchIndex = new Map<string, string>(
  catalog.routes.map((r) => [
    `/r/${r.slug}`,
    `/r/${r.slug} ${r.service} ${r.category ?? "other"} ${searchText(r.description ?? "", r.slug)}`.toLowerCase(),
  ])
);

/** Aggregates over the FULL catalog — they never depend on the page returned. */
function fullStats() {
  const byCategory: Record<string, { services: number; routes: number }> = {};
  const svcSets: Record<string, Set<string>> = {};
  for (const r of catalog.routes) {
    const k = r.category ?? "other";
    (byCategory[k] ??= { services: 0, routes: 0 }).routes += 1;
    (svcSets[k] ??= new Set()).add(r.service);
  }
  for (const k of Object.keys(byCategory)) byCategory[k]!.services = svcSets[k]!.size;
  return {
    routes: catalog.routes.length,
    services: new Set(catalog.routes.map((r) => r.service)).size,
    byCategory,
  };
}

/** The machine-readable catalog payload — shared by free /catalog and paid /discover. */
export function catalogPayload(cfg: Config, query: CatalogQuery = {}): Record<string, unknown> {
  const q = (query.q ?? "").toLowerCase().trim();
  const category = (query.category ?? "").toLowerCase().trim();
  const service = (query.service ?? "").toLowerCase().trim();
  const tier = (query.tier ?? "").toLowerCase().trim();
  const method = (query.method ?? "").toUpperCase().trim();
  const maxPrice = Number.isFinite(query.maxPrice) ? (query.maxPrice as number) : null;

  let rows = allRows();
  const filtered = !!(q || category || service || tier || method || maxPrice != null);
  if (filtered) {
    rows = rows.filter((w) => {
      // Match on everything we know the route by, not just what we display —
      // see searchText() for why the census wording still earns its keep.
      if (q && !searchIndex.get(w.path)!.includes(q)) return false;
      if (category && !w.category.toLowerCase().includes(category)) return false;
      if (service && !w.service.toLowerCase().includes(service)) return false;
      if (tier && w.trust_tier.toLowerCase() !== tier) return false;
      if (method && w.method !== method) return false;
      if (maxPrice != null && Number(w.price.replace("$", "")) > maxPrice) return false;
      return true;
    });
  }

  const total = rows.length;
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const all = query.limit === "all";
  const limit = all
    ? total
    : Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(query.limit) || DEFAULT_LIMIT)));
  const page = rows.slice(offset, offset + limit);
  const nextOffset = offset + page.length;

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  if (service) params.set("service", service);
  if (tier) params.set("tier", tier);
  if (method) params.set("method", method);
  if (maxPrice != null) params.set("max_price", String(maxPrice));
  params.set("offset", String(nextOffset));
  params.set("limit", String(limit));

  return {
    name: "Roam402 | the x402 roaming gateway",
    by: "agents-trust.ai",
    network: cfg.chain.caip2,
    asset: `USDC (ASA ${cfg.chain.usdcAsaId})`,
    how: "GET any route below without payment to receive an x402 402 challenge; retry with X-PAYMENT via the GoPlausible facilitator.",
    native: NATIVE_ROUTES.map((n) => ({
      path: n.path,
      price: usdString(n.priceUsd),
      description: n.description,
    })),
    categories: [...new Set(catalog.routes.map((r) => r.category ?? "other"))].sort(),
    stats: fullStats(),
    // Paging contract — `total` is the match count, not the page size.
    total,
    returned: page.length,
    offset,
    filtered,
    next: nextOffset < total ? `/catalog?${params}` : null,
    hint:
      "Narrow before you page: ?q= ?category= ?service= ?tier= ?method= ?max_price=. " +
      `Default page ${DEFAULT_LIMIT}, ?limit= up to ${MAX_LIMIT}, ?limit=all returns all ` +
      `${catalog.routes.length} routes (~1MB — it will fill an agent context). ` +
      "stats.byCategory covers the whole catalog regardless of this page.",
    wrapped: page,
    generatedAt: catalog.generatedAt,
  };
}

/** Parse the catalog query string — shared by free /catalog and paid /discover. */
export function queryFromRequest(req: { query(k: string): string | undefined }): CatalogQuery {
  const rawLimit = (req.query("limit") ?? "").trim().toLowerCase();
  const maxPrice = Number(req.query("max_price"));
  return {
    q: req.query("q"),
    category: req.query("category"),
    service: req.query("service"),
    tier: req.query("tier"),
    method: req.query("method"),
    maxPrice: Number.isFinite(maxPrice) ? maxPrice : undefined,
    limit: rawLimit === "all" ? "all" : Number(rawLimit) || undefined,
    offset: Number(req.query("offset")) || 0,
  };
}

export function mountFreeRoutes(app: Hono<AppEnv>, cfg: Config, hasWallet: boolean, kv: KVNamespace | undefined): void {
  app.get("/healthz", async (c) =>
    c.json({
      ok: true,
      network: cfg.network,
      wrappedRoutes: catalog.routes.length,
      nativeRoutes: NATIVE_ROUTES.length,
      catalogGeneratedAt: catalog.generatedAt,
      fulfilment: hasWallet ? "ready" : "wallet-missing",
      killSwitch: cfg.killSwitch,
      signedReceipts: !!cfg.receiptSigningJwk,
      breakerTrips: openTripCount(),
      lastHealthSweep: await getHealthSummary(kv),
    })
  );

  // /catalog?q=&category=&service=&limit= — server-side filtering so no
  // client ever needs the full list to find one capability.
  app.get("/catalog", (c) => c.json(catalogPayload(cfg, queryFromRequest(c.req))));
}
