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
  if (!privateKey || !privateKey.startsWith("0x")) return null;
  try {
    return privateKeyToAccount(privateKey as `0x${string}`);
  } catch {
    return null;
  }
}
