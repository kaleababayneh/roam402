/**
 * scripts/new-evm-account.ts — generate the two EVM accounts for the
 * cross-chain loop test (Base Sepolia; faucet money only).
 *
 *   pnpm account:evm
 *
 * Writes .secrets/sepolia-hotwallet.json (the gateway's paying wallet — fund
 * with faucet USDC) and .secrets/sepolia-origin.json (the mock origin
 * seller's payTo — receives, needs nothing). TESTNET ONLY: mainnet wallets
 * are created by a human in a real wallet app, never by this script.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const here = dirname(fileURLToPath(import.meta.url));
const secretsDir = join(here, "..", ".secrets");
mkdirSync(secretsDir, { recursive: true });

function makeAccount(file: string, role: string): void {
  const dest = join(secretsDir, file);
  if (existsSync(dest)) {
    console.log(`· ${file} exists — keeping it`);
    return;
  }
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  writeFileSync(dest, `${JSON.stringify({ network: "base-sepolia", role, address: account.address, privateKey: pk }, null, 2)}\n`, { mode: 0o600 });
  console.log(`✓ ${role}: ${account.address}`);
}

makeAccount("sepolia-hotwallet.json", "gateway-hot-wallet");
makeAccount("sepolia-origin.json", "mock-origin-seller");

console.log("\nFund ONLY the hot wallet with Base Sepolia USDC (no ETH needed — EIP-3009 is gasless for the payer):");
console.log("  https://faucet.circle.com → network 'Base Sepolia' → paste the gateway-hot-wallet address");
