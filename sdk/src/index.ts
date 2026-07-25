/**
 * roam402 — client SDK for the Roam402 gateway.
 *
 *   import { createRoamClient, signerFromMnemonic } from "roam402";
 *
 *   const roam = createRoamClient({
 *     signer: await signerFromMnemonic(process.env.ALGO_MNEMONIC!),
 *     network: "mainnet",
 *   });
 *
 *   const scan  = await roam.call("quickintel-scan-full", { query: { chain: "base", tokenAddress: "0x…" } });
 *   const trust = await roam.trust("blockrun.ai");
 *
 * Every paid call settles USDC on Algorand via the GoPlausible facilitator;
 * the gateway fulfils cross-chain and returns dual-chain receipt headers
 * (X-Roam-Origin-Receipt / X-Roam-Origin-Chain).
 */

import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactAvmScheme } from "@x402/avm/exact/client";
import type { ClientAvmSigner } from "@x402/avm";

export type RoamNetwork = "testnet" | "mainnet";

const CAIP2: Record<RoamNetwork, `${string}:${string}`> = {
  testnet: "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
  mainnet: "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=",
};

const DEFAULT_GATEWAY: Record<RoamNetwork, string> = {
  testnet: "http://localhost:8787",
  mainnet: "https://roam402.com",
};

export interface RoamClientOptions {
  /** Algorand signer (wallet adapter or from signerFromMnemonic()). */
  signer: ClientAvmSigner;
  network?: RoamNetwork;
  /** Override the gateway base URL (e.g. staging). */
  gatewayUrl?: string;
}

export interface CallOptions {
  /** Query params appended to the route. */
  query?: Record<string, string>;
  /** JSON body — sent iff the route is POST. */
  body?: unknown;
  method?: "GET" | "POST";
}

export interface TrustReport {
  domain: string;
  found: boolean;
  trust_tier?: string;
  trust_score?: string | number | null;
  verified_volume_usd_total?: string | null;
  [k: string]: unknown;
}

export interface PrecheckReport {
  url: string;
  known_seller: boolean;
  trust_tier: string;
  verdict: string;
  [k: string]: unknown;
}

export interface CatalogEntry {
  path: string;
  price: string;
  service?: string;
  trust_tier?: string;
  description: string;
}

export interface RoamClient {
  /** Call a wrapped route by slug; pays the 402 automatically. */
  call(slug: string, opts?: CallOptions): Promise<Response>;
  /** Agents-Trust trust report for an x402 seller domain (paid, $0.005). */
  trust(domain: string): Promise<TrustReport>;
  /** Pre-flight safety check for any x402 endpoint URL (paid, $0.002). */
  precheck(url: string): Promise<PrecheckReport>;
  /** Free machine-readable catalog of everything callable. */
  catalog(): Promise<{ native: CatalogEntry[]; wrapped: CatalogEntry[] }>;
  /** The payment-enabled fetch, for calling the gateway directly. */
  fetch: typeof fetch;
}

export function createRoamClient(opts: RoamClientOptions): RoamClient {
  const network = opts.network ?? "mainnet";
  const base = (opts.gatewayUrl ?? DEFAULT_GATEWAY[network]).replace(/\/$/, "");

  const client = new x402Client().register(CAIP2[network], new ExactAvmScheme(opts.signer));
  const payingFetch = wrapFetchWithPayment(fetch, client) as typeof fetch;

  const getJson = async <T>(path: string): Promise<T> => {
    const res = await payingFetch(`${base}${path}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`roam402 ${path} → HTTP ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  };

  return {
    fetch: payingFetch,

    async call(slug: string, callOpts: CallOptions = {}): Promise<Response> {
      const qs = callOpts.query ? `?${new URLSearchParams(callOpts.query)}` : "";
      const method = callOpts.method ?? (callOpts.body !== undefined ? "POST" : "GET");
      return payingFetch(`${base}/r/${slug}${qs}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(callOpts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(callOpts.body !== undefined ? { body: JSON.stringify(callOpts.body) } : {}),
      });
    },

    trust: (domain: string) => getJson<TrustReport>(`/trust?domain=${encodeURIComponent(domain)}`),

    precheck: (url: string) => getJson<PrecheckReport>(`/precheck?url=${encodeURIComponent(url)}`),

    catalog: () => getJson<{ native: CatalogEntry[]; wrapped: CatalogEntry[] }>("/catalog"),
  };
}

/**
 * Build a signer from a 25-word Algorand mnemonic.
 * Requires the optional `algosdk` peer dependency (server-side use).
 */
export async function signerFromMnemonic(mnemonic: string): Promise<ClientAvmSigner> {
  const [{ default: algosdk }, { toClientAvmSigner }] = await Promise.all([
    import("algosdk"),
    import("@x402/avm"),
  ]);
  const account = algosdk.mnemonicToSecretKey(mnemonic);
  const b64 = Buffer.from(account.sk).toString("base64");
  return toClientAvmSigner(b64);
}
