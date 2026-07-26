/**
 * scripts/latency-test.ts — where does the time actually go?
 *
 *   pnpm latency
 *
 * Measures, with real testnet payments:
 *   1. unpaid 402 issuance            (pure server overhead)
 *   2. paid NATIVE call (/trust)      (verify → handler → inbound settle)
 *   3. paid CROSS-CHAIN (/r/test-sepolia)
 *      (verify → origin 402+pay+settle on Sepolia → inbound settle)
 * The delta between 2 and 3 is the roaming tax; the delta between 1 and 2
 * is the price of settlement itself.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import algosdk from "algosdk";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactAvmScheme } from "@x402/avm/exact/client";
import { toClientAvmSigner } from "@x402/avm";
import { CHAINS } from "../src/config";

const GATEWAY = process.argv[2] ?? "http://localhost:8787";
const here = dirname(fileURLToPath(import.meta.url));
const { mnemonic } = JSON.parse(
  readFileSync(join(here, "..", ".secrets", "testnet-buyer.json"), "utf8")
) as { mnemonic: string };

const signer = toClientAvmSigner(
  Buffer.from(algosdk.mnemonicToSecretKey(mnemonic).sk).toString("base64")
);
const client = new x402Client().register(CHAINS.testnet.caip2, new ExactAvmScheme(signer));
const payingFetch = wrapFetchWithPayment(fetch, client);

async function timed(label: string, fn: () => Promise<Response>): Promise<void> {
  const t = Date.now();
  const res = await fn();
  await res.text();
  console.log(`${label.padEnd(34)} ${String(Date.now() - t).padStart(6)} ms   (HTTP ${res.status})`);
}

// Warm the isolate first so we measure the flow, not cold start.
await fetch(`${GATEWAY}/healthz`);

await timed("unpaid 402 issuance", () => fetch(`${GATEWAY}/trust?domain=x`));
await timed("paid NATIVE  /trust", () => payingFetch(`${GATEWAY}/trust?domain=blockrun.ai`, { headers: { Accept: "application/json" } }));
await timed("paid NATIVE  /discover", () => payingFetch(`${GATEWAY}/discover`, { headers: { Accept: "application/json" } }));
await timed("paid X-CHAIN /r/test-sepolia", () => payingFetch(`${GATEWAY}/r/test-sepolia`, { headers: { Accept: "application/json" } }));
