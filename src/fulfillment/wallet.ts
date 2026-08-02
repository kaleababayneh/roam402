/**
 * src/fulfillment/wallet.ts — the Base hot wallet that pays origin services.
 *
 * Custody rules:
 *  - Private key arrives ONLY via the BASE_WALLET_PRIVATE_KEY secret.
 *  - This module never logs, serialises, or re-exports the key material —
 *    it hands out a viem Account object and nothing else.
 *  - Absent key → gateway runs in "no-fulfillment" mode: free routes work,
 *    wrapped routes refuse BEFORE any buyer payment is taken.
 */

import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export function loadBaseWallet(privateKey: string | undefined): PrivateKeyAccount | null {
  // Wallet apps export with or without the 0x prefix, and interactive
  // `wrangler secret put` pastes can carry stray whitespace — normalise both.
  const raw = privateKey?.trim();
  if (!raw) return null;
  const hex = /^[0-9a-fA-F]{64}$/.test(raw) ? `0x${raw}` : raw;
  if (!hex.startsWith("0x")) return null;
  try {
    return privateKeyToAccount(hex as `0x${string}`);
  } catch {
    return null;
  }
}
