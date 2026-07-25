/**
 * src/payment/server.ts — the x402 resource-server adapter (Algorand side).
 *
 * The ONLY module that speaks the server side of x402. Everything the
 * @x402 libraries need — route config, AVM scheme, facilitator client,
 * Bazaar discovery extension, challenge tag — is assembled here from the
 * catalog, so an upstream API change touches exactly one file.
 *
 * Settlement timing: paymentMiddleware verifies before the handler runs and
 * settles after it succeeds — a thrown GatewayError in the handler aborts
 * settlement, which is our no-charge-on-failure guarantee (confirmed in the
 * P0 testnet run; see docs/RUNBOOK.md).
 */

import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { RoutesConfig, RouteConfig } from "@x402/core/server";
import { ExactAvmScheme } from "@x402/avm/exact/server";
import { paymentMiddleware } from "@x402/hono";
import { bazaarResourceServerExtension } from "@x402/extensions";
import type { MiddlewareHandler } from "hono";
import { CHALLENGE_TAG, type Config } from "../config";
import { catalog } from "../catalog";
import { usdString } from "../pricing";
import { NATIVE_ROUTES } from "../routes/native";

/** One x402 payment option on our Algorand merchant, USDC-ASA denominated. */
function accepts(cfg: Config, priceUsd: number): RouteConfig["accepts"] {
  return {
    scheme: "exact",
    network: cfg.chain.caip2,
    payTo: cfg.payTo,
    price: usdString(priceUsd),
    extra: {
      asset: cfg.chain.usdcAsaId,
      decimals: cfg.chain.usdcDecimals,
      // Challenge tag per the official checklist — this is how the
      // leaderboard attributes and tracks the entry.
      tag: CHALLENGE_TAG,
    },
  };
}

/** Full route-config map: every wrapped slug + every native paid route. */
function buildRouteConfig(cfg: Config): RoutesConfig {
  const routes: Record<string, RouteConfig> = {};

  for (const r of catalog.routes) {
    routes[`${r.method} /r/${r.slug}`] = {
      accepts: accepts(cfg, r.roamPriceUsd),
      description: r.description,
      mimeType: "application/json",
      serviceName: "Roam402",
      tags: [CHALLENGE_TAG, "roam402", r.tier.toLowerCase(), r.service],
    };
  }

  for (const n of NATIVE_ROUTES) {
    routes[`GET ${n.path}`] = {
      accepts: accepts(cfg, n.priceUsd),
      description: n.description,
      mimeType: "application/json",
      serviceName: "Roam402",
      tags: [CHALLENGE_TAG, "roam402", "trust"],
    };
  }

  return routes;
}

/** Hono middleware enforcing 402s + settlement for all paid routes. */
export async function buildPaymentMiddleware(cfg: Config): Promise<MiddlewareHandler> {
  const facilitator = new HTTPFacilitatorClient({ url: cfg.facilitatorUrl });
  const server = new x402ResourceServer(facilitator)
    .register(cfg.chain.caip2, new ExactAvmScheme())
    .registerExtension(bazaarResourceServerExtension);
  // Explicit awaited initialize(): fetches the facilitator's supported kinds
  // (required before 402s can be built). The middleware's lazy
  // syncFacilitatorOnStart both races (empty accepts) and hangs under
  // workerd — so we do it deterministically here, inside request context,
  // and disable the middleware's own sync.
  await server.initialize();
  return paymentMiddleware(buildRouteConfig(cfg), server, undefined, undefined, false);
}
