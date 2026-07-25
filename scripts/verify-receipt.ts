/**
 * scripts/verify-receipt.ts — prove a Roam402 receipt is cryptographically real.
 *
 *   pnpm verify:receipt
 *
 * Makes a paid call, extracts the signed receipt, and verifies its JWS
 * signature against the public key embedded in the receipt's did:jwk kid —
 * no key registry, no trust in the server. This is the "verifiable receipts"
 * claim, demonstrated end-to-end.
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

const here = dirname(fileURLToPath(import.meta.url));
const { mnemonic } = JSON.parse(
  readFileSync(join(here, "..", ".secrets", "testnet-buyer.json"), "utf8")
) as { mnemonic: string };

const account = algosdk.mnemonicToSecretKey(mnemonic);
const signer = toClientAvmSigner(Buffer.from(account.sk).toString("base64"));
const client = new x402Client().register(CHAINS.testnet.caip2, new ExactAvmScheme(signer));
const payingFetch = wrapFetchWithPayment(fetch, client);

const url = process.argv[2] ?? "http://localhost:8787/trust?domain=blockrun.ai";
const res = await payingFetch(url, { headers: { Accept: "application/json" } });
console.log("paid call:", res.status);

const receipt = extractReceiptFromResponse(res);
if (!receipt || receipt.format !== "jws") {
  console.error("no signed JWS receipt on response");
  process.exit(1);
}
const jws = (receipt as JWSSignedReceipt).signature;

// Resolve the public key straight from the kid — did:jwk carries it inline.
const header = extractJWSHeader(jws);
const kid = header.kid ?? "";
const jwkB64 = kid.replace(/^did:jwk:/, "").replace(/#.*$/, "");
const pubJwk = JSON.parse(Buffer.from(jwkB64, "base64url").toString("utf8")) as JWK;
console.log("receipt kid:", kid.slice(0, 48), "…");
console.log("resolved public key:", pubJwk.kty, pubJwk.crv);

const payload = await verifyReceiptSignatureJWS(receipt as JWSSignedReceipt, pubJwk);
console.log("\n✅ signature VERIFIED against the did:jwk public key");
console.log("verified receipt payload:", JSON.stringify(payload).slice(0, 300));
