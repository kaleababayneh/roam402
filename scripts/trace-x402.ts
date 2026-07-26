/**
 * scripts/trace-x402.ts — the anatomy of one paid call, fully decoded.
 *
 *   pnpm trace [url]        # default: /trust?domain=blockrun.ai ($0.005)
 *
 * Instruments the real client flow (a spy fetch inside wrapFetchWithPayment)
 * and prints every x402 orchestration stage with decoded payloads:
 *
 *   1. unpaid request  → 402 PAYMENT-REQUIRED (challenge, decoded)
 *   2. client builds the payment (signed Algorand txn group — decoded,
 *      showing the facilitator's fee abstraction: buyer pays 0 ALGO fee)
 *   3. paid retry      → server: guard → facilitator VERIFY → handler →
 *                        facilitator SETTLE → response
 *   4. PAYMENT-RESPONSE (settlement, decoded) + signed JWS receipt
 *      (VERIFIED against its did:jwk)
 *   5. the settlement transaction as recorded on-chain (indexer lookup)
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import algosdk from "algosdk";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactAvmScheme } from "@x402/avm/exact/client";
import { toClientAvmSigner } from "@x402/avm";
import {
  extractReceiptFromResponse,
  extractJWSHeader,
  verifyReceiptSignatureJWS,
  type JWSSignedReceipt,
} from "@x402/extensions";
import type { JWK } from "jose";
import { CHAINS } from "../src/config";

const url = process.argv[2] ?? "http://localhost:8787/trust?domain=blockrun.ai";
const here = dirname(fileURLToPath(import.meta.url));
const { mnemonic, address } = JSON.parse(
  readFileSync(join(here, "..", ".secrets", "testnet-buyer.json"), "utf8")
) as { mnemonic: string; address: string };

const b64json = (s: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(s, "base64").toString("utf8")) as Record<string, unknown>;

const H = (title: string): void => console.log(`\n━━ ${title} ${"━".repeat(Math.max(0, 60 - title.length))}`);

// ── Spy fetch: capture both legs of the payment flow ──────────────────────────
interface Leg { at: number; ms: number; status: number; paymentHeader: string | null; res: Response }
const legs: Leg[] = [];
const spyFetch: typeof fetch = async (input, init) => {
  const t = Date.now();
  let paymentHeader: string | null = null;
  const scan = (h: Headers): void =>
    h.forEach((v, k) => {
      if (k.toLowerCase().includes("payment")) paymentHeader = v;
    });
  scan(new Headers(init?.headers));
  if (input instanceof Request) scan(input.headers);
  const res = await fetch(input, init);
  legs.push({ at: t, ms: Date.now() - t, status: res.status, paymentHeader, res: res.clone() });
  return res;
};

const signer = toClientAvmSigner(
  Buffer.from(algosdk.mnemonicToSecretKey(mnemonic).sk).toString("base64")
);
const client = new x402Client().register(CHAINS.testnet.caip2, new ExactAvmScheme(signer));
const payingFetch = wrapFetchWithPayment(spyFetch, client);

console.log(`buyer  ${address}`);
console.log(`target ${url}`);
const t0 = Date.now();
const finalRes = await payingFetch(url, { headers: { Accept: "application/json" } });
const body = await finalRes.text();
const total = Date.now() - t0;

// ── 1. the challenge ──────────────────────────────────────────────────────────
const first = legs[0];
if (!first) throw new Error("no request legs captured");
H(`STAGE 1 · unpaid request → HTTP ${first.status} in ${first.ms}ms`);
const pr = first.res.headers.get("PAYMENT-REQUIRED");
if (pr) {
  const challenge = b64json(pr);
  const acc = (challenge.accepts as Record<string, unknown>[])[0]!;
  const extra = acc.extra as Record<string, unknown>;
  console.log(`accepts: ${acc.scheme} · ${acc.network}`);
  console.log(`amount:  ${acc.amount} µUSDC (ASA ${extra.asset}) → payTo ${String(acc.payTo).slice(0, 12)}…`);
  console.log(`extra:   tag=${extra.tag} · feePayer=${String(extra.feePayer).slice(0, 12)}… · catalog=${extra.catalog}`);
  console.log(`resource extensions: ${Object.keys((challenge.extensions as object) ?? {}).join(", ")}`);
}

// ── 2. the payment the client constructed ────────────────────────────────────
const second = legs[1];
if (!second) throw new Error("payment leg missing — client did not retry");
H("STAGE 2 · client builds + signs the payment");
console.log(`thinking time between legs: ${second.at - (first.at + first.ms)}ms (sign + assemble)`);
if (second.paymentHeader) {
  const payload = b64json(second.paymentHeader);
  console.log(`X-PAYMENT payload: x402Version=${payload.x402Version} · ${payload.scheme ?? ""} ${payload.network ?? ""}`);
  const inner = payload.payload as Record<string, unknown> | undefined;
  const txnB64s: string[] = [];
  const dig = (v: unknown): void => {
    if (typeof v === "string" && v.length > 80) txnB64s.push(v);
    else if (Array.isArray(v)) v.forEach(dig);
    else if (v && typeof v === "object") Object.values(v).forEach(dig);
  };
  dig(inner);
  for (const [i, b] of txnB64s.entries()) {
    try {
      const st = algosdk.decodeSignedTransaction(Buffer.from(b, "base64"));
      const txn = st.txn;
      const fee = Number(txn.fee ?? 0);
      const axfer = txn.assetTransfer;
      console.log(
        `  txn[${i}]: ${txn.type} · fee=${fee} µALGO${fee === 0 ? "  ← fee abstraction: facilitator pays" : ""}` +
          (axfer ? ` · ${Number(axfer.amount)} µUSDC → ${axfer.receiver.toString().slice(0, 10)}…` : "")
      );
    } catch { /* not a txn blob */ }
  }
}

// ── 3. the paid round trip ────────────────────────────────────────────────────
H(`STAGE 3 · paid retry → guard → VERIFY → handler → SETTLE → HTTP ${second.status} in ${second.ms}ms`);
console.log(`(server-side, in order: kill-switch/breaker/health guards → facilitator verify —`);
console.log(` no chain wait — → /trust handler queries the Agents-Trust census → facilitator`);
console.log(` settles USDC on Algorand — ~2.8s finality lives here — → response released)`);

// ── 4. settlement + signed receipt ───────────────────────────────────────────
H("STAGE 4 · settlement proof + signed receipt");
const settleRaw = finalRes.headers.get("PAYMENT-RESPONSE");
let txid: string | null = null;
if (settleRaw) {
  const settle = b64json(settleRaw);
  txid = (settle.transaction as string) ?? null;
  console.log(`PAYMENT-RESPONSE: success=${settle.success} · payer=${String(settle.payer).slice(0, 12)}… · tx=${txid}`);
}
const receipt = extractReceiptFromResponse(finalRes);
if (receipt?.format === "jws") {
  const jws = (receipt as JWSSignedReceipt).signature;
  const kid = extractJWSHeader(jws).kid ?? "";
  const pub = JSON.parse(
    Buffer.from(kid.replace(/^did:jwk:/, "").replace(/#.*$/, ""), "base64url").toString("utf8")
  ) as JWK;
  const verified = await verifyReceiptSignatureJWS(receipt as JWSSignedReceipt, pub);
  console.log(`JWS receipt: alg=EdDSA · kid=did:jwk:…${kid.slice(-12)}`);
  console.log(`  ✅ signature VERIFIED · payload: ${JSON.stringify(verified).slice(0, 160)}…`);
}

// ── 5. what the chain says ────────────────────────────────────────────────────
if (txid) {
  H("STAGE 5 · the settlement on-chain (indexer)");
  for (let i = 0; i < 10; i++) {
    const r = await fetch(`https://testnet-idx.algonode.cloud/v2/transactions/${txid}`);
    if (r.ok) {
      const j = (await r.json()) as { transaction: Record<string, unknown> };
      const t = j.transaction;
      const ax = t["asset-transfer-transaction"] as Record<string, unknown>;
      console.log(`round ${t["confirmed-round"]} · ${ax.amount} µUSDC (ASA ${ax["asset-id"]})`);
      console.log(`${String(t.sender).slice(0, 12)}… → ${String(ax.receiver).slice(0, 12)}…`);
      break;
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
}

H(`DONE · total ${total}ms · body: ${body.slice(0, 80)}…`);
