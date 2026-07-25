/**
 * src/routes/wrapped.ts — the gateway's reason to exist.
 *
 * GET /r/{slug} : buyer has paid (or is paying) USDC on Algorand; we fetch
 * the origin service on its home chain with our hot wallet and stream the
 * result back with dual-chain receipt headers.
 *
 * Guard order matters — everything that can refuse a request runs BEFORE the
 * x402 middleware ever issues a 402, so an agent is never asked to sign a
 * payment we already know we cannot fulfil:
 *   kill switch → route exists → breaker closed → wallet present → spend cap.
 * Origin failure inside the handler throws, which aborts settlement.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Config } from "../config";
import { findRoute } from "../catalog";
import { callOrigin } from "../fulfillment/origin";
import { isOpen, recordFailure, recordSuccess } from "../fulfillment/breaker";
import { withReceiptHeaders } from "../payment/receipts";
import { GatewayError, breakerOpenError, killSwitchError, spendCapError } from "../lib/errors";
import { log } from "../lib/log";

/** Origin chain label for receipts — phase 1 fulfils on Base only. */
const ORIGIN_CHAIN = "eip155:8453";

export function buildGuard(cfg: Config, hasWallet: boolean): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;
    const isPaid = path.startsWith("/r/") || path === "/trust" || path === "/precheck";
    if (!isPaid) return next();

    if (cfg.killSwitch) throw killSwitchError();

    if (path.startsWith("/r/")) {
      const slug = path.slice(3);
      const route = findRoute(slug);
      if (!route) throw new GatewayError(`Unknown route /r/${slug}`, 404, "unknown_route");
      if (isOpen(slug)) throw breakerOpenError(slug);
      if (!hasWallet) throw new GatewayError("Gateway fulfilment wallet not configured", 503, "no_wallet");
      if (route.originPriceUsd > cfg.perRequestCapUsd) {
        throw spendCapError(route.originPriceUsd, cfg.perRequestCapUsd);
      }
    }
    return next();
  };
}

export function buildWrappedHandler(payingFetch: typeof fetch) {
  return async (c: Context): Promise<Response> => {
    const slug = c.req.param("slug") ?? "";
    const route = findRoute(slug);
    // Guard already 404'd unknown slugs; this satisfies the type system.
    if (!route) throw new GatewayError(`Unknown route /r/${slug}`, 404, "unknown_route");

    const query = c.req.url.split("?")[1] ?? "";
    const started = Date.now();
    try {
      const { response, receipt } = await callOrigin(payingFetch, route.originUrl, query, ORIGIN_CHAIN);
      recordSuccess(slug);
      log("wrapped_ok", { slug, service: route.service, ms: Date.now() - started });
      return withReceiptHeaders(response, {
        service: route.service,
        tier: route.tier,
        origin: receipt,
      });
    } catch (err) {
      recordFailure(slug);
      log("wrapped_fail", { slug, service: route.service, ms: Date.now() - started });
      throw err; // aborts settlement — buyer is not charged
    }
  };
}
