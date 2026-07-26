/**
 * scripts/soak-test.ts — concurrency proof: N simultaneous paid calls.
 *
 *   pnpm soak [n] [url]     # default 12 × /r/test-sepolia
 *
 * One buyer wallet signs N payments at once; one hot wallet pays N origins
 * at once — the exact contention shape of a busy leaderboard minute.
 * Reports success rate + latency spread, then verifies the AGGREGATE ledger
 * delta on both chains (balances, not headers).
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

const N = Number(process.argv[2] ?? 12);
const URL_ = process.argv[3] ?? "http://localhost:8787/r/test-sepolia";
const ROAM_PRICE = 0.001;
const ORIGIN_PRICE = 0.001;

const here = dirname(fileURLToPath(import.meta.url));
const secret = <T>(f: string): T =>
  JSON.parse(readFileSync(join(here, "..", ".secrets", f), "utf8")) as T;
const buyer = secret<{ mnemonic: string; address: string }>("testnet-buyer.json");
const merchant = secret<{ address: string }>("testnet-merchant.json");
const hot = secret<{ address: `0x${string}` }>("sepolia-hotwallet.json");
const seller = secret<{ address: `0x${string}` }>("sepolia-origin.json");

const algod = new algosdk.Algodv2("", "https://testnet-api.algonode.cloud", "");
const sep = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

const algoUsdc = async (a: string): Promise<number> => {
  const info = await algod.accountInformation(a).do();
  const x = (info.assets ?? []).find((s) => Number(s.assetId) === 10458941);
  return x ? Number(x.amount) / 1e6 : 0;
};
const sepUsdc = async (a: `0x${string}`): Promise<number> =>
  Number(await sep.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] })) / 1e6;

const before = {
  buyer: await algoUsdc(buyer.address),
  merchant: await algoUsdc(merchant.address),
  hot: await sepUsdc(hot.address),
  seller: await sepUsdc(seller.address),
};
console.log(`soak: ${N} concurrent paid calls → ${URL_}`);
console.log("before:", before);

const signer = toClientAvmSigner(
  Buffer.from(algosdk.mnemonicToSecretKey(buyer.mnemonic).sk).toString("base64")
);
const client = new x402Client().register(CHAINS.testnet.caip2, new ExactAvmScheme(signer));
const payingFetch = wrapFetchWithPayment(fetch, client);

interface Shot { ok: boolean; status: number; ms: number; err?: string }
const t0 = Date.now();
const shots: Shot[] = await Promise.all(
  Array.from({ length: N }, async (): Promise<Shot> => {
    const t = Date.now();
    try {
      const res = await payingFetch(URL_, { headers: { Accept: "application/json" } });
      await res.text();
      return { ok: res.status === 200, status: res.status, ms: Date.now() - t };
    } catch (err) {
      return { ok: false, status: 0, ms: Date.now() - t, err: err instanceof Error ? err.message.slice(0, 80) : String(err) };
    }
  })
);
const wall = Date.now() - t0;

const okShots = shots.filter((s) => s.ok);
const lat = shots.map((s) => s.ms).sort((a, b) => a - b);
const pct = (p: number): number => lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))] ?? 0;
console.log(`\nresults: ${okShots.length}/${N} ok · wall ${wall}ms · p50 ${pct(50)}ms · p95 ${pct(95)}ms · max ${lat[lat.length - 1]}ms`);
for (const s of shots.filter((x) => !x.ok)) console.log(`  ✗ HTTP ${s.status} ${s.err ?? ""}`);

console.log("\nwaiting 8s for both chains to fully settle…");
await new Promise((r) => setTimeout(r, 8000));
const after = {
  buyer: await algoUsdc(buyer.address),
  merchant: await algoUsdc(merchant.address),
  hot: await sepUsdc(hot.address),
  seller: await sepUsdc(seller.address),
};
console.log("after: ", after);

const k = okShots.length;
const d = {
  buyer: +(after.buyer - before.buyer).toFixed(6),
  merchant: +(after.merchant - before.merchant).toFixed(6),
  hot: +(after.hot - before.hot).toFixed(6),
  seller: +(after.seller - before.seller).toFixed(6),
};
const expect_ = {
  buyer: +(-k * ROAM_PRICE).toFixed(6),
  merchant: +(k * ROAM_PRICE).toFixed(6),
  hot: +(-k * ORIGIN_PRICE).toFixed(6),
  seller: +(k * ORIGIN_PRICE).toFixed(6),
};
console.log("deltas:", d, "· expected for", k, "successes:", expect_);

const exact =
  d.buyer === expect_.buyer && d.merchant === expect_.merchant && d.hot === expect_.hot && d.seller === expect_.seller;
console.log(
  exact
    ? `\n✅ SOAK PASSED — ${k}/${N} succeeded and the ledgers account for EXACTLY ${k} payments on both chains (no double-pay, no phantom charge).`
    : "\n✗ ledger deltas do not match the success count — investigate before mainnet."
);
process.exit(exact && k === N ? 0 : 1);
