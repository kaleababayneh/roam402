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
import { getHealthSummary } from "../fulfillment/health";
import { openTripCount } from "../fulfillment/breaker";

/** The machine-readable catalog payload — shared by free /catalog and paid /discover. */
export function catalogPayload(cfg: Config): Record<string, unknown> {
  return {
    name: "Roam402 | the x402 roaming gateway",
    by: "agents-trust.com",
    network: cfg.chain.caip2,
    asset: `USDC (ASA ${cfg.chain.usdcAsaId})`,
    how: "GET any route below without payment to receive an x402 402 challenge; retry with X-PAYMENT via the GoPlausible facilitator.",
    native: NATIVE_ROUTES.map((n) => ({
      path: n.path,
      price: usdString(n.priceUsd),
      description: n.description,
    })),
    categories: [...new Set(catalog.routes.map((r) => (r.category ?? "other")))].sort(),
    wrapped: catalog.routes.map((r) => ({
      path: `/r/${r.slug}`,
      method: r.method,
      price: usdString(r.roamPriceUsd),
      service: r.service,
      trust_tier: r.tier,
      category: (r.category ?? "other"),
      description: r.description,
    })),
    generatedAt: catalog.generatedAt,
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
  app.get("/catalog", (c) => {
    const q = (c.req.query("q") ?? "").toLowerCase();
    const category = (c.req.query("category") ?? "").toLowerCase();
    const service = (c.req.query("service") ?? "").toLowerCase();
    const limit = Math.min(500, Number(c.req.query("limit")) || 500);
    const payload = catalogPayload(cfg) as { wrapped: { path: string; service?: string; trust_tier?: string; description: string; category?: string }[] } & Record<string, unknown>;
    if (q || category || service) {
      payload.wrapped = payload.wrapped
        .filter(
          (w) =>
            (!q || `${w.path} ${w.service} ${w.description}`.toLowerCase().includes(q)) &&
            (!category || (w.category ?? "").toLowerCase().includes(category)) &&
            (!service || (w.service ?? "").toLowerCase().includes(service))
        )
        .slice(0, limit);
      payload.filtered = true;
    } else if (payload.wrapped.length > limit) {
      payload.wrapped = payload.wrapped.slice(0, limit);
      payload.truncated = true;
    }
    return c.json(payload);
  });
}
