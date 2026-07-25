/**
 * src/payment/receipts.ts — the dual-chain receipt envelope.
 *
 * Roam402's differentiator: every fulfilled call is provable on BOTH chains.
 * The Algorand settlement txid arrives via the facilitator's settle response
 * (X-PAYMENT-RESPONSE header set by the x402 middleware); the origin-chain
 * settlement txid is surfaced by the origin's own x402 flow when available.
 * We forward what we verifiably have and never fabricate the rest.
 */

export const HEADER_ORIGIN_RECEIPT = "X-Roam-Origin-Receipt";
export const HEADER_ORIGIN_CHAIN = "X-Roam-Origin-Chain";
export const HEADER_SERVICE = "X-Roam-Service";
export const HEADER_TIER = "X-Roam-Trust-Tier";

export interface OriginReceipt {
  /** Origin x402 settlement payload (base64 X-PAYMENT-RESPONSE) if exposed. */
  paymentResponse: string | null;
  chain: string;
}

/** Attach roam receipt headers to the outgoing response. */
export function withReceiptHeaders(
  res: Response,
  meta: { service: string; tier: string; origin: OriginReceipt }
): Response {
  const out = new Response(res.body, res);
  out.headers.set(HEADER_SERVICE, meta.service);
  out.headers.set(HEADER_TIER, meta.tier);
  out.headers.set(HEADER_ORIGIN_CHAIN, meta.origin.chain);
  if (meta.origin.paymentResponse) {
    out.headers.set(HEADER_ORIGIN_RECEIPT, meta.origin.paymentResponse);
  }
  return out;
}
