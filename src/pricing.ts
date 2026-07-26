/**
 * src/pricing.ts — the margin model, in one place.
 *
 * TRACTION PRICING (since 2026-07-26): zero margin — we charge exactly the
 * origin price, rounded UP to a micro-USDC so rounding can never produce a
 * loss. Rationale: the leaderboard rewards volume, and price parity removes
 * the only reason not to route through us. Raising later = bump these two
 * constants + `pnpm catalog:generate` (mirror the change in
 * scripts/generate-catalog.ts). Native routes (no origin cost) price
 * themselves directly.
 */

const MARGIN = 0;
const FLAT_FEE_USD = 0;

/** Gateway price in USD for a wrapped route. */
export function roamPriceUsd(originPriceUsd: number): number {
  const raw = originPriceUsd * (1 + MARGIN) + FLAT_FEE_USD;
  return Math.ceil(raw * 1_000_000) / 1_000_000;
}

/** Format a USD number the way @x402 route configs expect ("$0.0365"). */
export function usdString(priceUsd: number): string {
  // toFixed(6) then trim trailing zeros — "$0.030500" → "$0.0305".
  const s = priceUsd.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `$${s}`;
}
