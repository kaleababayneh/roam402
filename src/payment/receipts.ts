/**
 * src/payment/receipts.ts — the dual-chain receipt envelope.
 *
 * Roam402's differentiator: every fulfilled call is provable on BOTH chains.
 * The Algorand settlement arrives via the middleware's PAYMENT-RESPONSE
 * header (plus a signed JWS receipt when enabled); the origin-chain
 * settlement is decoded from the origin's own PAYMENT-RESPONSE and surfaced
 * as verifiable fields (network + transaction hash) alongside the raw
 * header. We forward what we verifiably have and never fabricate the rest.
 */

export const HEADER_ORIGIN_RECEIPT = "X-Roam-Origin-Receipt";
export const HEADER_ORIGIN_CHAIN = "X-Roam-Origin-Chain";
export const HEADER_ORIGIN_TX = "X-Roam-Origin-Tx";
export const HEADER_SERVICE = "X-Roam-Service";
export const HEADER_TIER = "X-Roam-Trust-Tier";

export interface OriginReceipt {
  /** Origin's raw X402 settlement header (base64), when exposed. */
  raw: string | null;
  /** Decoded from the settlement — actual network the origin settled on. */
  network: string | null;
  /** Decoded settlement transaction hash on the origin chain. */
  transaction: string | null;
}

/** Attach roam receipt headers to the outgoing response. */
export function withReceiptHeaders(
  res: Response,
  meta: { service: string; tier: string; origin: OriginReceipt }
): Response {
  const out = new Response(res.body, res);
  out.headers.set(HEADER_SERVICE, meta.service);
  out.headers.set(HEADER_TIER, meta.tier);
  if (meta.origin.network) out.headers.set(HEADER_ORIGIN_CHAIN, meta.origin.network);
  if (meta.origin.transaction) out.headers.set(HEADER_ORIGIN_TX, meta.origin.transaction);
  if (meta.origin.raw) out.headers.set(HEADER_ORIGIN_RECEIPT, meta.origin.raw);
  return out;
}
