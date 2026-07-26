/**
 * src/fulfillment/origin.ts — pay-and-fetch against origin x402 services.
 *
 * The ONLY module that speaks the client side of x402 (EVM origins).
 * Flow per request: plain fetch → on 402, @x402/fetch retries with a payment
 * signed by the hot wallet. The origin's settlement (PAYMENT-RESPONSE) is
 * decoded into a verifiable receipt: actual network + transaction hash.
 *
 * Registered origin networks: Base mainnet (production catalog) and Base
 * Sepolia (the cross-chain loop test) — the client answers whichever the
 * origin's 402 demands, so no per-route chain wiring is needed.
 *
 * Buyer-safety invariant (enforced by call order in routes/wrapped.ts):
 * this runs BEFORE the buyer's Algorand payment is settled — an origin
 * failure aborts the whole request unpaid.
 */

import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { PrivateKeyAccount } from "viem/accounts";
import { GatewayError, originError, originTimeout, originUnreachable } from "../lib/errors";
import type { OriginReceipt } from "../payment/receipts";

const ORIGIN_TIMEOUT_MS = 25_000;

export const BASE_CAIP2 = "eip155:8453";
export const BASE_SEPOLIA_CAIP2 = "eip155:84532";

export interface OriginResult {
  response: Response;
  receipt: OriginReceipt;
}

/** Build a fetch that can satisfy EVM x402 challenges from our hot wallet. */
export function makePayingFetch(wallet: PrivateKeyAccount): typeof fetch {
  const scheme = new ExactEvmScheme(wallet);
  const client = new x402Client()
    .register(BASE_CAIP2, scheme)
    .register(BASE_SEPOLIA_CAIP2, scheme);
  return wrapFetchWithPayment(fetch, client) as typeof fetch;
}

/** Decode the origin's settlement header into verifiable receipt fields. */
function decodeReceipt(raw: string | null): OriginReceipt {
  if (!raw) return { raw: null, network: null, transaction: null };
  try {
    const settled = decodePaymentResponseHeader(raw);
    return {
      raw,
      network: settled.network ?? null,
      transaction: settled.transaction ?? null,
    };
  } catch {
    return { raw, network: null, transaction: null };
  }
}

/**
 * Call the origin endpoint, paying if challenged.
 * Query string and (for POST) the JSON body are forwarded verbatim.
 */
export async function callOrigin(
  payingFetch: typeof fetch,
  originUrl: string,
  incomingQuery: string,
  forward?: { method: "GET" | "POST"; body?: string | null; contentType?: string | null }
): Promise<OriginResult> {
  const url = incomingQuery
    ? `${originUrl}${originUrl.includes("?") ? "&" : "?"}${incomingQuery}`
    : originUrl;

  const method = forward?.method ?? "GET";
  const init: RequestInit = {
    method,
    signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
    headers: {
      Accept: "application/json, */*",
      ...(method === "POST"
        ? { "Content-Type": forward?.contentType ?? "application/json" }
        : {}),
    },
    ...(method === "POST" && forward?.body != null ? { body: forward.body } : {}),
  };

  // PREFLIGHT (unpaid, plain fetch — a 402 reply proves the origin is alive
  // and x402-speaking). Free to retry because no money can move here; this
  // converts most transport flakes into pre-payment failures.
  const preflight = async (): Promise<void> => {
    try {
      await fetch(url, init);
    } catch (err) {
      throw err instanceof Error && err.name === "TimeoutError" ? originTimeout() : originUnreachable();
    }
  };
  await preflight().catch(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await preflight();
  });

  // PAY EXACTLY ONCE. payingFetch pays on every invocation, so there are NO
  // automatic retries past this line — a transport failure here has unknown
  // payment state and must not be auto-repeated (retryable: false).
  let res: Response;
  try {
    res = await payingFetch(url, init);
  } catch {
    throw new GatewayError(
      "Origin delivery failed after payment may have been sent — not auto-retried",
      502,
      "origin_delivery_failed",
      false
    );
  }

  if (!res.ok) throw originError(res.status);

  return {
    response: res,
    receipt: decodeReceipt(
      res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE")
    ),
  };
}
