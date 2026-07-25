/**
 * scripts/optin.ts — opt the testnet accounts in to USDC (ASA 10458941).
 *
 *   pnpm optin
 *
 * For every account file in .secrets/: if it holds test ALGO and is not yet
 * opted in to the USDC ASA, send the 0-amount self asset-transfer that
 * constitutes an opt-in. Idempotent; testnet only by design.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import algosdk from "algosdk";
import { CHAINS } from "../src/config";

const ASA = Number(CHAINS.testnet.usdcAsaId);
const algod = new algosdk.Algodv2("", "https://testnet-api.algonode.cloud", "");

const secretsDir = join(dirname(fileURLToPath(import.meta.url)), "..", ".secrets");

interface AccountFile {
  network: string;
  address: string;
  mnemonic: string;
  role?: string;
}

async function processAccount(file: string): Promise<void> {
  const acc = JSON.parse(readFileSync(join(secretsDir, file), "utf8")) as AccountFile;
  if (acc.network !== "testnet") {
    console.log(`· ${file}: not testnet — skipped`);
    return;
  }
  const label = `${acc.role ?? "account"} ${acc.address.slice(0, 8)}…`;

  const info = await algod.accountInformation(acc.address).do();
  const algoBalance = Number(info.amount) / 1e6;
  const optedIn = (info.assets ?? []).some((a) => Number(a.assetId) === ASA);

  if (optedIn) {
    console.log(`✓ ${label}: already opted in (${algoBalance} ALGO)`);
    return;
  }
  if (algoBalance < 0.3) {
    console.log(`✗ ${label}: needs test ALGO first (has ${algoBalance}) → https://bank.testnet.algorand.network`);
    return;
  }

  const sk = algosdk.mnemonicToSecretKey(acc.mnemonic);
  const params = await algod.getTransactionParams().do();
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: acc.address,
    receiver: acc.address,
    amount: 0,
    assetIndex: ASA,
    suggestedParams: params,
  });
  const { txid } = await algod.sendRawTransaction(txn.signTxn(sk.sk)).do();
  await algosdk.waitForConfirmation(algod, txid, 8);
  console.log(`✓ ${label}: opted in to ASA ${ASA} (tx ${txid.slice(0, 12)}…)`);
}

for (const file of readdirSync(secretsDir).filter((f) => f.endsWith(".json"))) {
  await processAccount(file);
}
