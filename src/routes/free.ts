/**
 * src/routes/free.ts — unpaid surface: health + the catalog funnel.
 *
 * /catalog is deliberately free: it is how agents discover what they can
 * buy here. Selling the menu would starve the restaurant.
 */

import { Hono } from "hono";
import type { Config } from "../config";
import { catalog } from "../catalog";
import { NATIVE_ROUTES } from "./native";
import { usdString } from "../pricing";

export function mountFreeRoutes(app: Hono, cfg: Config, hasWallet: boolean): void {
  app.get("/healthz", (c) =>
    c.json({
      ok: true,
      network: cfg.network,
      wrappedRoutes: catalog.routes.length,
      nativeRoutes: NATIVE_ROUTES.length,
      fulfilment: hasWallet ? "ready" : "wallet-missing",
      killSwitch: cfg.killSwitch,
    })
  );

  app.get("/catalog", (c) =>
    c.json({
      name: "Roam402 — the x402 roaming gateway",
      by: "agents-trust.com",
      network: cfg.chain.caip2,
      asset: `USDC (ASA ${cfg.chain.usdcAsaId})`,
      how: "GET any route below without payment to receive an x402 402 challenge; retry with X-PAYMENT via the GoPlausible facilitator.",
      native: NATIVE_ROUTES.map((n) => ({
        path: n.path,
        price: usdString(n.priceUsd),
        description: n.description,
      })),
      wrapped: catalog.routes.map((r) => ({
        path: `/r/${r.slug}`,
        price: usdString(r.roamPriceUsd),
        service: r.service,
        trust_tier: r.tier,
        description: r.description,
      })),
      generatedAt: catalog.generatedAt,
    })
  );
}
