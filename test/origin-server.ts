/**
 * test/origin-server.ts — MOCK ORIGIN for the cross-chain loop test.
 *
 *   pnpm origin:dev            # serves http://localhost:8988
 *
 * Plays the role of a Base x402 seller, but on Base SEPOLIA (eip155:84532 —
 * supported by the same GoPlausible facilitator), so the gateway's full
 * pay-downstream path can be proven with faucet money only. Test scaffolding
 * by design: never deployed, never in the catalog on mainnet.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/hono";

const BASE_SEPOLIA = "eip155:84532";
const FACILITATOR = "https://facilitator.goplausible.xyz";

const here = dirname(fileURLToPath(import.meta.url));
const { address: payTo } = JSON.parse(
  readFileSync(join(here, "..", ".secrets", "sepolia-origin.json"), "utf8")
) as { address: string };

const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR }))
  .register(BASE_SEPOLIA, new ExactEvmScheme());
await server.initialize();

const app = new Hono();
app.use(
  "*",
  paymentMiddleware(
    {
      "GET /paid-data": {
        accepts: { scheme: "exact", network: BASE_SEPOLIA, payTo, price: "$0.001" },
        description: "Mock origin: pays $0.001 USDC on Base Sepolia, returns a signed blob.",
      },
    },
    server,
    undefined,
    undefined,
    false
  )
);
app.get("/paid-data", (c) =>
  c.json({ origin: "mock-sepolia-seller", paidData: "the-goods", at: new Date().toISOString() })
);

serve({ fetch: app.fetch, port: 8988 }, (info) => {
  console.log(`mock origin (Base Sepolia seller) on http://localhost:${info.port} · payTo ${payTo}`);
});
