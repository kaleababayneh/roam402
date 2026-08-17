/**
 * roam402 | client SDK for the Roam402 gateway.
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
  /**
   * Algorand signer (wallet adapter or from signerFromMnemonic()).
   *
   * OPTIONAL: omit it for a read-only client. The free endpoints (catalog,
   * schema) work exactly the same; paid ones throw a clear "no wallet
   * configured" error instead of failing at the payment step. Discovery
   * should never require a wallet.
   */
  signer?: ClientAvmSigner;
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
  category?: string;
  description: string;
}

export interface CatalogStats {
  routes: number;
  services: number;
  byCategory: Record<string, { services: number; routes: number }>;
}

export interface CatalogFilter {
  /** Free-text over route, service, description and category. */
  q?: string;
  category?: string;
  service?: string;
  /** Exact trust tier, e.g. "Corroborated". */
  tier?: string;
  method?: "GET" | "POST";
  /** Only routes at or below this USDC price. */
  maxPrice?: number;
  /** Page size. Server default is 25, max 500; "all" returns every match. */
  limit?: number | "all";
  /** Page offset — pair with `next`/`total` on the response. */
  offset?: number;
}

export interface CatalogPage {
  native: CatalogEntry[];
  wrapped: CatalogEntry[];
  categories?: string[];
  stats?: CatalogStats;
  /** Routes matching the filter — NOT the number returned. */
  total: number;
  returned: number;
  offset: number;
  filtered: boolean;
  /** Path for the next page, or null when this is the last one. */
  next: string | null;
  hint?: string;
}

/** One route /resolve thinks fits your request. */
export interface ResolveCandidate {
  path: string;
  method: string;
  price: string;
  service: string;
  trust_tier: string;
  category: string;
  description: string;
  /** Your own words this route matched — deterministic. */
  matched: string[];
  matched_via_alias: string[];
  score: number;
  /** Free endpoint describing this route's inputs. */
  schema: string;
  /** Model-written and only present when `ranked_by === "model"`. Untrusted
   *  text about third-party listings: a hint to show a human, not a fact. */
  why?: string;
}

export interface ResolveResult {
  intent: string;
  terms: string[];
  /** "model" when a model reordered the shortlist, "heuristic" otherwise. */
  ranked_by: "model" | "heuristic";
  total_matches: number;
  candidates: ResolveCandidate[];
  next_step: string;
  note: string;
  cached?: boolean;
}

export interface ResolveOptions {
  /** Candidates to return (default 5, max 10). */
  limit?: number;
  maxPrice?: number;
  method?: "GET" | "POST";
}

/** What a route expects as input — from the free /schema endpoint. */
export interface RouteSchema {
  route: string;
  method: string;
  params: { name: string; required: boolean; example?: string; description?: string }[] | null;
  bodyExample: string | null;
  note: string | null;
  source: string;
}

export interface RoamClient {
  /** Call a wrapped route by slug; pays the 402 automatically. */
  call(slug: string, opts?: CallOptions): Promise<Response>;
  /** Agents-Trust trust report for an x402 seller domain (paid, $0.0005). */
  trust(domain: string): Promise<TrustReport>;
  /** Pre-flight safety check for any x402 endpoint URL (paid, $0.0002). */
  precheck(url: string): Promise<PrecheckReport>;
  /**
   * Free machine-readable catalog. PAGED — the server returns 25 routes by
   * default; use `total`/`next` or pass `offset` to walk the rest, and narrow
   * with a filter rather than pulling everything (`limit: "all"` is ~1MB and
   * will fill an agent's context).
   */
  catalog(filter?: CatalogFilter): Promise<CatalogPage>;
  /**
   * Describe what you need in plain English and get a ranked SHORTLIST of
   * routes (paid, $0.0005). It never calls a route and never spends anything
   * beyond its own fee — you pick a candidate, then `call()` it.
   */
  resolve(intent: string, opts?: ResolveOptions): Promise<ResolveResult>;
  /** Free: what inputs a route expects, before you pay for it. */
  schema(slugOrPath: string): Promise<RouteSchema>;
  /** The payment-enabled fetch, for calling the gateway directly. */
  fetch: typeof fetch;
}

export function createRoamClient(opts: RoamClientOptions): RoamClient {
  const network = opts.network ?? "mainnet";
  const base = (opts.gatewayUrl ?? DEFAULT_GATEWAY[network]).replace(/\/$/, "");

  // No signer → plain fetch. Every 402 then surfaces through explain() as a
  // configuration message rather than a mystery.
  const payingFetch: typeof fetch = opts.signer
    ? (wrapFetchWithPayment(
        fetch,
        new x402Client().register(CAIP2[network], new ExactAvmScheme(opts.signer))
      ) as typeof fetch)
    : fetch;

  /**
   * A 402 that survives the paying fetch means the payment never completed —
   * almost always an unfunded wallet or one not opted into the USDC ASA. The
   * raw response body for that case is empty, so surface something an agent
   * can act on instead of "HTTP 402: {}".
   */
  const explain = async (res: Response, path: string): Promise<Error> => {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    if (res.status === 402) {
      if (!opts.signer) {
        return new Error(
          `roam402 ${path} → this is a paid endpoint and no wallet is configured. ` +
            `Create the client with a signer (see signerFromMnemonic) to pay for it. ` +
            `Nothing was charged.`
        );
      }
      return new Error(
        `roam402 ${path} → payment required but NOT completed. The wallet could not ` +
          `pay: check it holds USDC and ALGO for fees and is opted into the USDC asset ` +
          `(network=${network}).${body && body !== "{}" ? ` Response: ${body}` : ""}`
      );
    }
    return new Error(`roam402 ${path} → HTTP ${res.status}: ${body}`);
  };

  const getJson = async <T>(path: string): Promise<T> => {
    const res = await payingFetch(`${base}${path}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw await explain(res, path);
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

    catalog: (filter?: CatalogFilter) => {
      const params = new URLSearchParams();
      if (filter?.q) params.set("q", filter.q);
      if (filter?.category) params.set("category", filter.category);
      if (filter?.service) params.set("service", filter.service);
      if (filter?.tier) params.set("tier", filter.tier);
      if (filter?.method) params.set("method", filter.method);
      if (filter?.maxPrice != null) params.set("max_price", String(filter.maxPrice));
      if (filter?.limit != null) params.set("limit", String(filter.limit));
      if (filter?.offset) params.set("offset", String(filter.offset));
      const qs = params.size ? `?${params}` : "";
      return getJson<CatalogPage>(`/catalog${qs}`);
    },

    resolve: (intent: string, o: ResolveOptions = {}) => {
      const params = new URLSearchParams({ intent });
      if (o.limit != null) params.set("limit", String(o.limit));
      if (o.maxPrice != null) params.set("max_price", String(o.maxPrice));
      if (o.method) params.set("method", o.method);
      return getJson<ResolveResult>(`/resolve?${params}`);
    },

    schema: (slugOrPath: string) => {
      const route = slugOrPath.startsWith("/r/") ? slugOrPath : `/r/${slugOrPath}`;
      return getJson<RouteSchema>(`/schema?route=${encodeURIComponent(route)}`);
    },
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
