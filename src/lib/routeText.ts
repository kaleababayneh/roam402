/**
 * src/lib/routeText.ts — turning generated route descriptions into text worth
 * sending.
 *
 * Every catalog description ends in the same ~122-character tail ("· via
 * Roam402 from <service> (<tier> on Agents-Trust) · pay USDC on Algorand,
 * fulfilled on Base, dual-chain receipts."). It is true for every route, it is
 * already stated once in the catalog header, and repeating it 2,349 times is
 * roughly 287KB of payload that tells a reader nothing new — the single
 * biggest waste in an agent's context window.
 *
 * routeLabel() keeps only the part that differs. Shared by /marketplace (card
 * titles) and the catalog API (response descriptions) so both stay honest
 * about what is actually distinct per route.
 */

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
 * The human-meaningful part of a generated description: everything before the
 * shared " · via Roam402 …" tail, with the "METHOD /path on " prefix dropped
 * when present (both are already structured fields on the route).
 */
export function routeLabel(description: string, slug: string): string {
  const cut = description.indexOf(" · via Roam402");
  let head = (cut > 0 ? description.slice(0, cut) : description).trim();
  const m = head.match(/^(?:GET|POST)\s+\S+\s+on\s+(.+)$/);
  if (m?.[1]) head = m[1].trim();
  head = decodeEntities(head).replace(/\s+/g, " ").trim();
  return head || slug;
}

/**
 * Fallback display name for routes whose description head is just the
 * service's own page title — 1,767 of 2,349 of them, which would render four
 * identical "Ottoai" cards. Slugs are generated as
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
