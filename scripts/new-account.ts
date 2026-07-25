/**
 * scripts/new-account.ts — generate a fresh Algorand account for TESTNET.
 *
 *   pnpm account:new
 *
 * Writes address + mnemonic to .secrets/testnet-account.json (gitignored).
 * TESTNET ONLY — create the mainnet payTo in a real wallet (Pera/Defly),
 * never with this script; that address is permanent for the competition.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import algosdk from "algosdk";

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, "..", ".secrets", "testnet-account.json");

if (existsSync(dest)) {
  console.error(`refusing to overwrite existing ${dest}`);
  process.exit(1);
}

const account = algosdk.generateAccount();
const mnemonic = algosdk.secretKeyToMnemonic(account.sk);

mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, `${JSON.stringify({ network: "testnet", address: account.addr.toString(), mnemonic }, null, 2)}\n`, {
  mode: 0o600,
});

console.log("✓ testnet account created (secrets in .secrets/, gitignored)");
console.log(`  address: ${account.addr.toString()}`);
console.log("\nFund it (both required):");
console.log("  1. test ALGO:  https://bank.testnet.algorand.network");
console.log("  2. opt-in + test USDC (ASA 10458941): see docs/RUNBOOK.md step 2");
