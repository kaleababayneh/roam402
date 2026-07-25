/**
 * scripts/debug-402.ts — reproduce the 402 path under plain Node (no workerd).
 * Uses Hono's app.request() test harness; distinguishes a library hang from a
 * workerd-compat hang. Temporary P0 diagnostic.
 */

import { Hono } from "hono";
import { buildPaymentMiddleware } from "../src/payment/server";
import type { Config } from "../src/config";
import { CHAINS } from "../src/config";

const cfg: Config = {
  network: "testnet",
  chain: CHAINS.testnet,
  payTo: "VKBLLIKMUDZWUECFTNXSBEER67GNSI55EF5VVRY5DZUSO75IOITXDJDLAM",
  facilitatorUrl: "https://facilitator.goplausible.xyz",
  killSwitch: false,
  perRequestCapUsd: 1,
};

const app = new Hono();
app.use("*", await buildPaymentMiddleware(cfg));
app.get("/trust", (c) => c.json({ paid: true }));

const timer = setTimeout(() => {
  console.error("HANG: no response within 20s");
  process.exit(2);
}, 20_000);

const res = await app.request("/trust?domain=blockrun.ai", {
  headers: { Accept: "application/json" },
});
clearTimeout(timer);
console.log("status:", res.status);
const pr = res.headers.get("payment-required");
if (pr) {
  const payload = JSON.parse(Buffer.from(pr, "base64").toString("utf8")) as {
    x402Version: number;
    accepts?: Record<string, unknown>[];
  };
  console.log("x402Version:", payload.x402Version);
  console.log("accepts[0]:", JSON.stringify(payload.accepts?.[0], null, 1));
} else {
  console.log("NO payment-required header");
}
process.exit(0);
