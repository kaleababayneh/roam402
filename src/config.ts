/**
 * src/config.ts — single source of truth for chain constants + env parsing.
 *
 * Every network-specific value lives here and ONLY here. Flipping
 * NETWORK=testnet → mainnet must be the entire chain cutover.
 * Values per the Algorand Global x402 Challenge checklist (2026-07-21)
 * and verified against live Bazaar `accepts` payloads.
 */

export type NetworkName = "testnet" | "mainnet";

/** CAIP-2 id shape the @x402 `Network` type expects. */
export type Caip2 = `${string}:${string}`;

export interface ChainConfig {
  /** CAIP-2 network id used in x402 `accepts.network`. */
  caip2: Caip2;
  /** USDC ASA id on this network (string, as the facilitator expects). */
  usdcAsaId: string;
  usdcDecimals: number;
}

export const CHAINS: Record<NetworkName, ChainConfig> = {
  testnet: {
    caip2: "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
    usdcAsaId: "10458941",
    usdcDecimals: 6,
  },
  mainnet: {
    caip2: "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=",
    usdcAsaId: "31566704",
    usdcDecimals: 6,
  },
};

/** Required challenge tag — routes carrying it are tracked on the leaderboard. */
export const CHALLENGE_TAG = "x402-global-challenge";

/** Worker env bindings (wrangler [vars] + secrets). */
export interface Env {
  NETWORK: string;
  PAY_TO_ADDRESS: string;
  FACILITATOR_URL: string;
  KILL_SWITCH: string;
  PER_REQUEST_CAP_USD: string;
  /** Secret — Base hot wallet that pays origin services. */
  BASE_WALLET_PRIVATE_KEY?: string;
  /** Optional KV binding — receipts log + route health (see src/receipts/store.ts). */
  RECEIPTS?: KVNamespace;
  /** Secret — Ed25519 private JWK enabling signed offers/receipts. */
  RECEIPT_SIGNING_JWK?: string;
  /** Dev/testnet only — injects the /r/test-sepolia loop-test route. */
  TEST_ORIGIN_URL?: string;
}

export interface Config {
  network: NetworkName;
  chain: ChainConfig;
  payTo: string;
  facilitatorUrl: string;
  killSwitch: boolean;
  perRequestCapUsd: number;
  /** Ed25519 private JWK (JSON) — signed receipts feature flag + key. */
  receiptSigningJwk?: string;
  /** Loop-test origin URL — honored ONLY on testnet (never mainnet). */
  testOriginUrl?: string;
}

export function loadConfig(env: Env): Config {
  const network = env.NETWORK === "mainnet" ? "mainnet" : "testnet";
  return {
    network,
    chain: CHAINS[network],
    payTo: env.PAY_TO_ADDRESS ?? "",
    facilitatorUrl: env.FACILITATOR_URL || "https://facilitator.goplausible.xyz",
    killSwitch: env.KILL_SWITCH === "on",
    perRequestCapUsd: Number.parseFloat(env.PER_REQUEST_CAP_USD || "1") || 1,
    receiptSigningJwk: env.RECEIPT_SIGNING_JWK,
    testOriginUrl: network === "testnet" ? env.TEST_ORIGIN_URL || undefined : undefined,
  };
}
