/**
 * src/fulfillment/origin.ts — pay-and-fetch against origin x402 services.
 *
 * The ONLY module that speaks the client side of x402 (Base/EVM origins).
 * Flow per request: plain fetch → on 402, @x402/fetch retries with a payment
 * signed by the Base hot wallet. Origin settlement receipt (the origin's
 * X-PAYMENT-RESPONSE header) is captured for the dual-chain receipt.
 *
 * Buyer-safety invariant (enforced by call order in routes/wrapped.ts):
 * this runs BEFORE the buyer's Algorand payment is settled — an origin
 * failure aborts the whole request unpaid.
 */

import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { PrivateKeyAccount } from "viem/accounts";
import { originError } from "../lib/errors";
import type { OriginReceipt } from "../payment/receipts";

const ORIGIN_TIMEOUT_MS = 25_000;

/** Phase 1 fulfils on Base only. */
export const BASE_CAIP2 = "eip155:8453";

export interface OriginResult {
  response: Response;
  receipt: OriginReceipt;
}

/** Build a fetch that can satisfy EVM x402 challenges from our hot wallet.
 *  A viem PrivateKeyAccount provides the `address` + `signTypedData` the
 *  exact-EVM flow requires. */
export function makePayingFetch(wallet: PrivateKeyAccount): typeof fetch {
  const client = new x402Client().register(BASE_CAIP2, new ExactEvmScheme(wallet));
  return wrapFetchWithPayment(fetch, client) as typeof fetch;
}

/**
 * Call the origin endpoint, paying if challenged.
 * Query string and (for POST) the JSON body are forwarded verbatim.
 */
export async function callOrigin(
  payingFetch: typeof fetch,
  originUrl: string,
  incomingQuery: string,
  originChain: string,
  forward?: { method: "GET" | "POST"; body?: string | null; contentType?: string | null }
): Promise<OriginResult> {
  const url = incomingQuery
    ? `${originUrl}${originUrl.includes("?") ? "&" : "?"}${incomingQuery}`
    : originUrl;

  const method = forward?.method ?? "GET";
  const res = await payingFetch(url, {
    method,
    signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
    headers: {
      Accept: "application/json, */*",
      ...(method === "POST"
        ? { "Content-Type": forward?.contentType ?? "application/json" }
        : {}),
    },
    ...(method === "POST" && forward?.body != null ? { body: forward.body } : {}),
  });

  if (!res.ok) throw originError(res.status);

  return {
    response: res,
    receipt: {
      paymentResponse: res.headers.get("X-PAYMENT-RESPONSE"),
      chain: originChain,
    },
  };
}
