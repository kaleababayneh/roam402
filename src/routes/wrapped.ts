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
import type { AppEnv } from "../lib/appEnv";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Config } from "../config";
import { findRoute } from "../catalog";
import { callOrigin } from "../fulfillment/origin";
import { isOpen, recordFailure, recordSuccess } from "../fulfillment/breaker";
import { isOriginDown } from "../fulfillment/health";
import { withReceiptHeaders } from "../payment/receipts";
import { GatewayError, breakerOpenError, killSwitchError, spendCapError } from "../lib/errors";
import { log } from "../lib/log";
import type { ReceiptStore } from "../receipts/store";

export function buildGuard(cfg: Config, hasWallet: boolean, kv: KVNamespace | undefined): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const path = c.req.path;
    const isPaid = path.startsWith("/r/") || path === "/trust" || path === "/precheck" || path === "/discover";
    if (!isPaid) return next();

    if (cfg.killSwitch) throw killSwitchError();

    if (path.startsWith("/r/")) {
      const slug = path.slice(3);
      const route = findRoute(slug, cfg.testOriginUrl);
      if (!route) throw new GatewayError(`Unknown route /r/${slug}`, 404, "unknown_route");
      // The x402 paywall is registered per "METHOD path", so a request using
      // the OTHER method matched no payment config, skipped the 402 entirely,
      // and still reached the origin on our wallet — the caller paid nothing
      // and we paid the seller. Refuse before payment and before fulfilment.
      if (c.req.method !== route.method) {
        throw new GatewayError(
          `/r/${slug} is ${route.method}, not ${c.req.method}`,
          405,
          "method_not_allowed"
        );
      }
      if (await isOpen(slug, kv)) throw breakerOpenError(slug);
      if (await isOriginDown(kv, slug)) throw breakerOpenError(slug);
      if (!hasWallet) throw new GatewayError("Gateway fulfilment wallet not configured", 503, "no_wallet");
      if (route.originPriceUsd > cfg.perRequestCapUsd) {
        throw spendCapError(route.originPriceUsd, cfg.perRequestCapUsd);
      }
    }
    return next();
  };
}

export function buildWrappedHandler(payingFetch: typeof fetch, receipts: ReceiptStore, cfg: Config, kv: KVNamespace | undefined) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const slug = c.req.param("slug") ?? "";
    const route = findRoute(slug, cfg.testOriginUrl);
    // Guard already 404'd unknown slugs; this satisfies the type system.
    if (!route) throw new GatewayError(`Unknown route /r/${slug}`, 404, "unknown_route");

    const query = c.req.url.split("?")[1] ?? "";
    const started = Date.now();
    try {
      const forward =
        route.method === "POST"
          ? {
              method: "POST" as const,
              body: await c.req.text(),
              contentType: c.req.header("content-type") ?? "application/json",
            }
          : { method: "GET" as const };
      const { response, receipt } = await callOrigin(payingFetch, route.originUrl, query, forward);
      recordSuccess(slug, kv);
      log("wrapped_ok", { rid: c.get("rid"), slug, service: route.service, ms: Date.now() - started });
      await receipts.record({
        ts: new Date().toISOString(),
        route: `/r/${slug}`,
        service: route.service,
        method: route.method,
        priceUsd: route.roamPriceUsd,
        originReceipt: receipt.transaction ?? receipt.raw,
        originChain: receipt.network,
      });
      return withReceiptHeaders(response, {
        service: route.service,
        tier: route.tier,
        origin: receipt,
      });
    } catch (err) {
      recordFailure(slug, kv);
      log("wrapped_fail", { rid: c.get("rid"), slug, service: route.service, ms: Date.now() - started });
      throw err; // aborts settlement — buyer is not charged
    }
  };
}
