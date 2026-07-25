/**
 * src/routes/native.ts — Roam402's own products (no origin, pure margin).
 *
 * Fixed paths with query params (no path wildcards — keeps x402 route
 * matching exact and boring). Data comes from the public Agents-Trust API;
 * we sell the convenience + the trust computation, not private data.
 */

import { Hono } from "hono";
import { GatewayError } from "../lib/errors";

const AGENTS_TRUST_API = "https://api.agents-trust.ai";

export interface NativeRoute {
  path: string;
  priceUsd: number;
  description: string;
}

export const NATIVE_ROUTES: NativeRoute[] = [
  {
    path: "/trust",
    priceUsd: 0.005,
    description:
      "Trust report for an x402 seller domain: Agents-Trust tier (Corroborated/Established/Emerging/Listed), 0-100 score, and evidence pillars from $45M+ of indexed on-chain settlement. Query: ?domain=example.com",
  },
  {
    path: "/precheck",
    priceUsd: 0.002,
    description:
      "Pre-flight safety check before your agent pays an unknown x402 endpoint: known-seller match, trust tier, liveness, and price sanity vs catalogued price. Query: ?url=https://…",
  },
];

async function fetchAgentsTrust(path: string): Promise<unknown> {
  const res = await fetch(`${AGENTS_TRUST_API}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new GatewayError("Trust index unavailable", 502, "index_error");
  return res.json();
}

interface LeaderboardRow {
  domain?: string;
  display_name?: string;
  trust_tier?: string;
  trust_score?: string | number | null;
  verified_volume_usd_total?: string | null;
  verified_tx_total?: string | null;
  first_settlement_at?: string | null;
  [k: string]: unknown;
}

async function leaderboardRows(): Promise<LeaderboardRow[]> {
  const body = (await fetchAgentsTrust("/q/leaderboard")) as { data?: LeaderboardRow[] };
  return body.data ?? [];
}

/** Mount the native paid handlers (payment middleware runs before these). */
export function mountNativeRoutes(app: Hono): void {
  app.get("/trust", async (c) => {
    const domain = (c.req.query("domain") ?? "").toLowerCase().trim();
    if (!domain) throw new GatewayError("Missing ?domain=", 400, "bad_request");

    const rows = await leaderboardRows();
    const row = rows.find((r) => (r.domain ?? "").toLowerCase() === domain);
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
    let host: string;
    try {
      host = new URL(raw).hostname.toLowerCase();
    } catch {
      throw new GatewayError("Missing or invalid ?url=", 400, "bad_request");
    }

    const rows = await leaderboardRows();
    const row = rows.find(
      (r) => (r.domain ?? "").toLowerCase() === host || host.endsWith(`.${(r.domain ?? "").toLowerCase()}`)
    );
    return c.json({
      url: raw,
      seller_domain_match: row?.domain ?? null,
      known_seller: !!row,
      trust_tier: row?.trust_tier ?? "Unknown",
      trust_score: row?.trust_score ?? null,
      verdict: row
        ? "known seller — see trust_tier before paying"
        : "unknown seller — no settlement history in the census; pay with caution",
      source: "agents-trust.com census",
    });
  });
}
