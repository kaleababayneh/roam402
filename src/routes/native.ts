/**
 * src/routes/native.ts — Roam402's own products (no origin, pure margin).
 *
 * Fixed paths with query params (no path wildcards — keeps x402 route
 * matching exact and boring). Data comes from the public Agents-Trust API;
 * we sell the convenience + the trust computation, not private data.
 */

import { Hono } from "hono";
import type { AppEnv } from "../lib/appEnv";
import { declareDiscoveryExtension } from "@x402/extensions";
import type { RouteConfig } from "@x402/core/server";
import type { Config } from "../config";
import { GatewayError } from "../lib/errors";
import { catalogPayload } from "./free";
import type { ReceiptStore } from "../receipts/store";
import { censusRows } from "../lib/census";
import { catalog } from "../catalog";
import { getRouteHealth } from "../fulfillment/health";

export interface NativeRoute {
  path: string;
  priceUsd: number;
  description: string;
  /** Bazaar discovery declaration — makes the catalog entry self-describing. */
  discovery: Record<string, unknown>;
}

export const NATIVE_ROUTES: NativeRoute[] = [
  {
    path: "/discover",
    priceUsd: 0.0001,
    description:
      "Machine-readable catalog of 50+ verified x402 services callable through this merchant — LLM inference, token security, market data — each with USDC price, Agents-Trust tier and liveness. Same payload is free at /catalog; this paid twin exists so the index itself is a discoverable x402 resource.",
    discovery: declareDiscoveryExtension({
      input: {},
      output: {
        example: {
          name: "Roam402 | the x402 roaming gateway",
          wrapped: [{ path: "/r/quickintel-scan-full", method: "GET", price: "$0.03", service: "quickintel.io", trust_tier: "Listed" }],
          native: [{ path: "/trust", price: "$0.005" }],
        },
      },
    }),
  },
  {
    path: "/trust",
    priceUsd: 0.005,
    description:
      "Trust report for an x402 seller domain: Agents-Trust tier (Corroborated/Established/Emerging/Listed), 0-100 score, and evidence pillars from $45M+ of indexed on-chain settlement. Query: ?domain=example.com",
    discovery: declareDiscoveryExtension({
      input: { domain: "blockrun.ai" },
      inputSchema: {
        type: "object",
        required: ["domain"],
        properties: { domain: { type: "string", description: "x402 seller domain to look up" } },
      },
      output: {
        example: { domain: "blockrun.ai", found: true, trust_tier: "Emerging", trust_score: 0.857 },
      },
    }),
  },
  {
    path: "/precheck",
    priceUsd: 0.002,
    description:
      "Pre-flight safety check before your agent pays an x402 endpoint: known-seller match + trust tier from the Agents-Trust census, and — for endpoints in the Roam402 catalog — the catalogued price, our route, and the last liveness probe verdict. Query: ?url=https://…",
    discovery: declareDiscoveryExtension({
      input: { url: "https://blockrun.ai/api/v1/chat/completions" },
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: { url: { type: "string", description: "Full x402 endpoint URL to vet before paying" } },
      },
      output: {
        example: { url: "https://…", known_seller: true, trust_tier: "Emerging", verdict: "known seller — see trust_tier before paying" },
      },
    }),
  },
];

/** Native routes as x402 RouteConfig extensions (merged with signed receipts). */
export function nativeRouteExtensions(path: string): RouteConfig["extensions"] {
  const route = NATIVE_ROUTES.find((r) => r.path === path);
  return route?.discovery as RouteConfig["extensions"];
}

async function leaderboardRows() {
  try {
    return await censusRows();
  } catch {
    throw new GatewayError("Trust index unavailable", 502, "index_error");
  }
}

/** Mount the native paid handlers (payment middleware runs before these). */
export function mountNativeRoutes(app: Hono<AppEnv>, cfg: Config, kv: KVNamespace | undefined, receipts: ReceiptStore): void {
  /** Native settlements belong on the proof-of-payers log too. */
  const record = (path: string): Promise<void> =>
    receipts.record({
      ts: new Date().toISOString(),
      route: path,
      service: "roam402-native",
      method: "GET",
      priceUsd: NATIVE_ROUTES.find((r) => r.path === path)?.priceUsd ?? 0,
      originReceipt: null,
      originChain: null,
    });

  app.get("/discover", async (c) => {
    await record("/discover");
    return c.json(catalogPayload(cfg));
  });

  app.get("/trust", async (c) => {
    const domain = (c.req.query("domain") ?? "").toLowerCase().trim();
    if (!domain) throw new GatewayError("Missing ?domain=", 400, "bad_request");

    const { rows, stale } = await leaderboardRows();
    const row = rows.find((r) => (r.domain ?? "").toLowerCase() === domain);
    if (stale) c.header("X-Roam-Census", "stale");
    await record("/trust");
    if (!row) {
      return c.json({ domain, found: false, note: "Not in the Agents-Trust census — treat as unverified." });
    }
    return c.json({
      domain,
      found: true,
      display_name: row.display_name ?? null,
      trust_tier: row.trust_tier ?? "Unrated",
      trust_score: row.trust_score ?? null,
      verified_volume_usd_total: row.verified_volume_usd_total ?? null,
      verified_tx_total: row.verified_tx_total ?? null,
      first_settlement_at: row.first_settlement_at ?? null,
      source: "agents-trust.com census",
    });
  });

  app.get("/precheck", async (c) => {
    const raw = c.req.query("url") ?? "";
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      throw new GatewayError("Missing or invalid ?url=", 400, "bad_request");
    }
    const host = target.hostname.toLowerCase();

    // Seller identity: census match by domain (exact or subdomain).
    const { rows, stale } = await leaderboardRows();
    const row = rows.find(
      (r) => (r.domain ?? "").toLowerCase() === host || host.endsWith(`.${(r.domain ?? "").toLowerCase()}`)
    );

    // Catalog match: is this exact endpoint one we wrap? Then we can also
    // report its catalogued price, our route, and the last probe verdict.
    const catRoute = catalog.routes.find((r) => {
      try {
        const o = new URL(r.originUrl);
        return o.hostname.toLowerCase() === host && o.pathname === target.pathname;
      } catch {
        return false;
      }
    });
    const health = catRoute ? await getRouteHealth(kv, catRoute.slug) : null;

    const verdict = !row
      ? "unknown seller — no settlement history in the census; pay with caution"
      : health?.status === "down"
        ? "known seller but the endpoint failed its last liveness probe — do not pay"
        : "known seller — see trust_tier before paying";

    if (stale) c.header("X-Roam-Census", "stale");
    await record("/precheck");
    return c.json({
      url: raw,
      seller_domain_match: row?.domain ?? null,
      known_seller: !!row,
      trust_tier: row?.trust_tier ?? "Unknown",
      trust_score: row?.trust_score ?? null,
      in_roam_catalog: !!catRoute,
      roam_route: catRoute ? `/r/${catRoute.slug}` : null,
      catalogued_price_usd: catRoute?.originPriceUsd ?? null,
      liveness: health
        ? { status: health.status, checked_at: health.at }
        : { status: "unprobed", checked_at: null },
      verdict,
      source: "agents-trust.com census + roam402 catalog probes",
    });
  });
}
