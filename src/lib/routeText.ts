/**
 * src/lib/routeText.ts — turning generated route descriptions into text worth
 * sending.
 *
 * Every catalog description ends in the same ~122-character tail ("· via
 * Roam402 from <service> (<tier> on Agents-Trust) · pay USDC on Algorand,
 * fulfilled on Base, dual-chain receipts."). It is true for every route, it is
 * already stated once in the catalog header, and repeating it once per route is
 * hundreds of KB of payload that tells a reader nothing new — the single
 * biggest waste in an agent's context window.
 *
 * routeLabel() keeps only the part that differs. Shared by /marketplace (card
 * titles) and the catalog API (response descriptions) so both stay honest
 * about what is actually distinct per route.
 */

import enrichmentJson from "../../catalog/enrichment.json";

/**
 * Origin-published endpoint summaries, mined at build time by
 * scripts/enrich-catalog.ts (see its header for the why and the trust rules).
 *
 * UNTRUSTED: this text is authored by third-party services. It is sanitised
 * when mined, and every consumer must render it as TEXT — never as markup, and
 * never as instructions to a model that decides where money goes.
 */
const ENRICHMENT = enrichmentJson as {
  routes: Record<string, { summary: string | null; source: string } | undefined>;
};

/** The origin's own description of an endpoint, when it publishes one. */
export function originSummary(slug: string): string | null {
  return ENRICHMENT.routes[slug]?.summary ?? null;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

/**
 * What this route actually does, best source first.
 *
 * The origin's own summary wins when we have one: the census description is
 * derived from the service's page, so for a multi-endpoint service it is
 * usually the site title and is sometimes attached to the WRONG endpoint
 * (laso-auth was described as "send a payment via Venmo or PayPal" when it
 * returns a Firebase token). The origin describing its own endpoint is the
 * more authoritative statement.
 *
 * Falling back: the part of the generated description before the shared
 * " · via Roam402 …" tail, with the "METHOD /path on " prefix dropped (both
 * are already structured fields on the route).
 */
export function routeLabel(description: string, slug: string): string {
  return originSummary(slug) ?? censusLabel(description, slug);
}

/** The census-derived label alone, ignoring anything mined from the origin. */
export function censusLabel(description: string, slug: string): string {
  const cut = description.indexOf(" · via Roam402");
  let head = (cut > 0 ? description.slice(0, cut) : description).trim();
  const m = head.match(/^(?:GET|POST)\s+\S+\s+on\s+(.+)$/);
  if (m?.[1]) head = m[1].trim();
  head = decodeEntities(head).replace(/\s+/g, " ").trim();
  return head || slug;
}

/**
 * Everything we know a route by, for matching — the origin's summary AND the
 * census text. Display should prefer the origin (it is authoritative about its
 * own endpoint), but search should not LOSE a word just because the origin
 * phrased it differently: dropping the census text cost "translate" half its
 * matches. Recall wants both; the label wants the accurate one.
 */
export function searchText(description: string, slug: string): string {
  const mined = originSummary(slug);
  const census = censusLabel(description, slug);
  if (!mined) return census;
  return mined.toLowerCase() === census.toLowerCase() ? mined : `${mined} ${census}`;
}

/**
 * Fallback display name for routes whose description head is just the
 * service's own page title — three quarters of them when measured — which
 * would render four identical "Ottoai" cards. Slugs are generated as
 * "<service-label>-<endpoint-path>", so dropping the service prefix leaves the
 * part that actually differs.
 */
export function endpointName(slug: string, service: string): string {
  const prefix = service.split(".")[0]?.toLowerCase() ?? "";
  let rest = slug;
  if (prefix && slug.toLowerCase().startsWith(prefix + "-")) rest = slug.slice(prefix.length + 1);
  rest = rest.replace(/-/g, " ").trim();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : slug;
}
