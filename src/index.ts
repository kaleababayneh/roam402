/**
 * src/index.ts — assembly only. All logic lives in its module:
 *
 *   config.ts               chain constants + env
 *   catalog.ts              generated route table
 *   payment/server.ts       x402/AVM resource server (the only x402-server import)
 *   fulfillment/origin.ts   x402/EVM paying client (the only x402-client import)
 *   routes/wrapped.ts       guards + the proxy handler
 *   routes/native.ts        /trust, /precheck
 *   routes/free.ts          /healthz, /catalog
 *
 * Request order: error boundary → free routes → guards → x402 payment →
 * paid handlers. Guards precede payment so no agent signs for a doomed call.
 */

import { Hono } from "hono";
import { loadConfig, type Config, type Env } from "./config";
import { buildPaymentMiddleware } from "./payment/server";
import { loadBaseWallet } from "./fulfillment/wallet";
import { makePayingFetch } from "./fulfillment/origin";
import { buildGuard, buildWrappedHandler } from "./routes/wrapped";
import type { AppEnv } from "./lib/appEnv";
import { mountNativeRoutes } from "./routes/native";
import { mountFreeRoutes } from "./routes/free";
import { mountLanding } from "./routes/landing";
import { mountReceipts } from "./routes/receipts";
import { mountStats } from "./routes/stats";
import { mountPlayground } from "./routes/playground";
import { makeReceiptStore } from "./receipts/store";
import { runHealthSweep } from "./fulfillment/health";
import { GatewayError } from "./lib/errors";
import { log } from "./lib/log";

interface Runtime {
  app: Hono<AppEnv>;
  cfg: Config;
}

let runtime: Promise<Runtime> | null = null;

async function buildRuntime(env: Env): Promise<Runtime> {
  const cfg = loadConfig(env);
  const wallet = loadBaseWallet(env.BASE_WALLET_PRIVATE_KEY);
  const payingFetch = wallet ? makePayingFetch(wallet) : fetch;

  const receipts = makeReceiptStore(env.RECEIPTS);
  const app = new Hono<AppEnv>();

  // Correlation id: on every log line and every response header, so any
  // failed call is reconstructable from either side.
  app.use("*", async (c, next) => {
    const rid = crypto.randomUUID().slice(0, 8);
    c.set("rid", rid);
    await next();
    c.res.headers.set("X-Roam-Request", rid);
  });

  app.onError((err, c) => {
    const rid = c.get("rid");
    if (err instanceof GatewayError) {
      log("gateway_error", { rid, code: err.code, status: err.status });
      return c.json({ error: err.code, message: err.message, retryable: err.retryable, request: rid }, err.status as 400);
    }
    log("unhandled_error", { rid, message: err instanceof Error ? err.message : String(err) });
    return c.json({ error: "internal", message: "Unexpected gateway error", request: rid }, 500);
  });

  mountLanding(app, cfg, env.RECEIPTS);
  mountPlayground(app, cfg);
  mountStats(app);
  mountReceipts(app, receipts);
  mountFreeRoutes(app, cfg, wallet !== null, env.RECEIPTS);
  app.use("*", buildGuard(cfg, wallet !== null, env.RECEIPTS));
  app.use("*", await buildPaymentMiddleware(cfg));
  mountNativeRoutes(app, cfg, env.RECEIPTS, receipts);
  const wrapped = buildWrappedHandler(payingFetch, receipts, cfg, env.RECEIPTS);
  app.get("/r/:slug", wrapped);
  app.post("/r/:slug", wrapped);

  log("runtime_built", { network: cfg.network, wallet: wallet !== null });
  return { app, cfg };
}

export default {
  /** Cron: probe every origin unpaid (402 = alive) and persist verdicts. */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    if (env.RECEIPTS) await runHealthSweep(env.RECEIPTS);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    // Isolate-lifetime memo — the x402 server (incl. its facilitator
    // initialize() round-trip) is built once, inside request context as
    // workerd requires. A failed build clears the memo so the next request
    // retries instead of caching a broken runtime.
    try {
      runtime ??= buildRuntime(env);
      const { app } = await runtime;
      return app.fetch(request, env);
    } catch (err) {
      runtime = null;
      throw err;
    }
  },
};
