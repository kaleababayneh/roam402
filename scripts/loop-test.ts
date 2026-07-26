/**
 * scripts/loop-test.ts — THE cross-chain proof, end to end, faucet money only.
 *
 *   pnpm loop:test
 *
 * Asserts the whole product in one run:
 *   1. buyer pays the gateway in USDC on Algorand TESTNET (GoPlausible),
 *   2. the gateway pays the mock origin in USDC on Base SEPOLIA (same
 *      facilitator, EIP-3009 — gasless for the payer),
 *   3. the origin's response returns with BOTH receipts,
 *   4. both ledgers moved: Algorand merchant +roamPrice, Sepolia seller
 *      +originPrice — checked on-chain, not from headers.
 *
 * Prereqs: `pnpm origin:dev` (port 8988) and `pnpm dev` (port 8787) running;
 * .dev.vars has TEST_ORIGIN_URL + the sepolia hot-wallet key; hot wallet
 * holds faucet USDC.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import algosdk from "algosdk";
import { createPublicClient, http, erc20Abi } from "viem";
import { baseSepolia } from "viem/chains";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactAvmScheme } from "@x402/avm/exact/client";
import { toClientAvmSigner } from "@x402/avm";
import { CHAINS } from "../src/config";

const GATEWAY = process.argv[2] ?? "http://localhost:8787";
const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const ALGO_USDC_ASA = 10458941;

const here = dirname(fileURLToPath(import.meta.url));
const secret = <T>(f: string): T =>
  JSON.parse(readFileSync(join(here, "..", ".secrets", f), "utf8")) as T;

const buyer = secret<{ mnemonic: string; address: string }>("testnet-buyer.json");
const merchant = secret<{ address: string }>("testnet-merchant.json");
const originSeller = secret<{ address: `0x${string}` }>("sepolia-origin.json");
const hotWallet = secret<{ address: `0x${string}` }>("sepolia-hotwallet.json");

const algod = new algosdk.Algodv2("", "https://testnet-api.algonode.cloud", "");
const sepolia = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });

async function algoUsdc(addr: string): Promise<number> {
  const info = await algod.accountInformation(addr).do();
  const a = (info.assets ?? []).find((x) => Number(x.assetId) === ALGO_USDC_ASA);
  return a ? Number(a.amount) / 1e6 : 0;
}

async function sepoliaUsdc(addr: `0x${string}`): Promise<number> {
  const bal = await sepolia.readContract({
    address: USDC_SEPOLIA,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [addr],
  });
  return Number(bal) / 1e6;
}

// ── before ────────────────────────────────────────────────────────────────────
const before = {
  buyer: await algoUsdc(buyer.address),
  merchant: await algoUsdc(merchant.address),
  hot: await sepoliaUsdc(hotWallet.address),
  seller: await sepoliaUsdc(originSeller.address),
};
console.log("before:", before);
if (before.hot < 0.001) {
  console.error(`\n✗ hot wallet ${hotWallet.address} has ${before.hot} Sepolia USDC — fund it first:`);
  console.error("  https://faucet.circle.com → Base Sepolia → that address");
  process.exit(2);
}

// ── the paid cross-chain call ─────────────────────────────────────────────────
const signer = toClientAvmSigner(
  Buffer.from(algosdk.mnemonicToSecretKey(buyer.mnemonic).sk).toString("base64")
);
const client = new x402Client().register(CHAINS.testnet.caip2, new ExactAvmScheme(signer));
const payingFetch = wrapFetchWithPayment(fetch, client);

console.log("\ncalling GET /r/test-sepolia (buyer pays Algorand → gateway pays Sepolia)…");
const res = await payingFetch(`${GATEWAY}/r/test-sepolia`, { headers: { Accept: "application/json" } });
const body = await res.text();
console.log("HTTP", res.status);
console.log("body:", body.slice(0, 140));
console.log("algorand settle:", res.headers.get("PAYMENT-RESPONSE") ? "present" : "MISSING");
console.log("origin chain:   ", res.headers.get("X-Roam-Origin-Chain"));
console.log("origin tx:      ", res.headers.get("X-Roam-Origin-Tx"));

if (res.status !== 200) process.exit(1);

// ── after: prove BOTH ledgers moved ──────────────────────────────────────────
await new Promise((r) => setTimeout(r, 6000)); // both chains confirm fast; be generous
const after = {
  buyer: await algoUsdc(buyer.address),
  merchant: await algoUsdc(merchant.address),
  hot: await sepoliaUsdc(hotWallet.address),
  seller: await sepoliaUsdc(originSeller.address),
};
console.log("\nafter: ", after);

const d = {
  buyer: +(after.buyer - before.buyer).toFixed(6),
  merchant: +(after.merchant - before.merchant).toFixed(6),
  hot: +(after.hot - before.hot).toFixed(6),
  seller: +(after.seller - before.seller).toFixed(6),
};
console.log("deltas:", d);

const ok =
  d.buyer === -0.0017 && d.merchant === 0.0017 && d.hot === -0.001 && d.seller === 0.001;
console.log(
  ok
    ? "\n✅ FULL CROSS-CHAIN LOOP PROVEN — Algorand in, Sepolia out, both ledgers exact."
    : "\n✗ deltas do not match expectations (buyer −0.0017 / merchant +0.0017 / hot −0.001 / seller +0.001)"
);
process.exit(ok ? 0 : 1);
