/**
 * scripts/smoke-client.ts — end-to-end buyer simulation on TESTNET.
 *
 *   pnpm smoke [url]            # default http://localhost:8787/trust?domain=blockrun.ai
 *
 * Loads the funded testnet account from .secrets/testnet-account.json, calls
 * the gateway, satisfies the 402 via the GoPlausible facilitator, and prints
 * the paid response + receipts. This is the P0 exit criterion.
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

const here = dirname(fileURLToPath(import.meta.url));
const secretsPath = join(here, "..", ".secrets", "testnet-buyer.json");

const url = process.argv[2] ?? "http://localhost:8787/trust?domain=blockrun.ai";

const { mnemonic, address } = JSON.parse(readFileSync(secretsPath, "utf8")) as {
  mnemonic: string;
  address: string;
};
const account = algosdk.mnemonicToSecretKey(mnemonic);
const signer = toClientAvmSigner(Buffer.from(account.sk).toString("base64"));
console.log(`buyer: ${address}`);

const client = new x402Client().register(CHAINS.testnet.caip2, new ExactAvmScheme(signer));
const payingFetch = wrapFetchWithPayment(fetch, client);

const res = await payingFetch(url, { headers: { Accept: "application/json" } });
console.log(`HTTP ${res.status}`);
console.log("X-PAYMENT-RESPONSE:", res.headers.get("X-PAYMENT-RESPONSE")?.slice(0, 80) ?? "(none)");
for (const h of ["X-Roam-Service", "X-Roam-Trust-Tier", "X-Roam-Origin-Chain", "X-Roam-Origin-Receipt"]) {
  const v = res.headers.get(h);
  if (v) console.log(`${h}:`, v.slice(0, 80));
}
console.log(await res.text());
