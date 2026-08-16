/**
 * scripts/enrich-catalog.ts — mine each origin's OWN description of its
 * endpoint and bake it into catalog/enrichment.json.
 *
 *   pnpm catalog:enrich                 # fetch only what is missing (idempotent)
 *   pnpm catalog:enrich --force         # refetch everything
 *   pnpm catalog:enrich --limit 30      # sample run, for checking yield first
 *
 * WHY: the census gives us a route table, not capability text. 1,767 of 2,349
 * generated descriptions are just "METHOD /path on <site title>", which is
 * nothing to search, rank, or explain a purchase with. But an x402 origin
 * publishes a description of the resource inside its own 402 challenge — the
 * same place /schema already reads params from. Asking each origin once, at
 * build time, turns "GET /v1/pool on LoneStar" into "Aerodrome DEX pool risk
 * assessment — checks both tokens for honeypots and rug vectors".
 *
 * The probe is an UNPAID request: an x402 origin answers 402 before doing any
 * work, so this costs the operator nothing and asks the origin for exactly the
 * metadata it publishes for discovery.
 *
 * Output is a SIDECAR keyed by slug, not a rewrite of routes.json: the route
 * table is regenerated from the census, and enrichment must survive that.
 * Committed like the catalog, so deploys stay reproducible and the diff is
 * reviewable.
 *
 * TRUST: every summary here is third-party text from an untrusted origin. It
 * is sanitised on the way in (control chars stripped, single line, length
 * capped) and must only ever be RENDERED AS TEXT, never as markup and never as
 * instructions to a model. See the note in src/lib/routeText.ts.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES = join(ROOT, "catalog", "routes.json");
const OUT = join(ROOT, "catalog", "enrichment.json");

const CONCURRENCY = 10;
const TIMEOUT_MS = 8_000;
const MAX_SUMMARY = 240;

const force = process.argv.includes("--force");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) || 0 : 0;

interface Route {
  slug: string;
  service: string;
  method: "GET" | "POST";
  originUrl: string;
  description: string;
}

/** One mined record. `source` records HOW we learned it, so a later reader can
 *  weigh it — "the origin said so" outranks "we inferred it". */
interface Enriched {
  summary: string | null;
  /** origin-402 | origin-402-name | none */
  source: string;
}

/** Third-party text: single line, no control characters, length capped. */
function sanitize(v: unknown, max = MAX_SUMMARY): string | null {
  if (typeof v !== "string") return null;
  const s = v
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

function decodeChallenge(raw: string | null): any {
  if (!raw) return null;
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const bin = Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64");
    return JSON.parse(new TextDecoder().decode(bin));
  } catch {
    return null;
  }
}

/**
 * Pull the best capability sentence the origin publishes. Preference order is
 * "most specific to this endpoint" first: the resource description, then the
 * bazaar info summary, then a resource name (weaker — often just a title).
 */
function summaryFrom(challenge: any): { summary: string | null; source: string } {
  if (!challenge || typeof challenge !== "object") return { summary: null, source: "none" };

  const resource = challenge.resource ?? {};
  const ext = challenge.extensions ?? {};
  const bz = ext.bazaar ?? (ext.info || ext.schema ? ext : null);

  const desc =
    sanitize(resource.description) ??
    sanitize(bz?.info?.description) ??
    sanitize(bz?.description) ??
    sanitize(challenge.description) ??
    // x402 v2 carries per-accept metadata on some origins
    sanitize(challenge.accepts?.[0]?.extra?.description);
  if (desc) return { summary: desc, source: "origin-402" };

  const name = sanitize(resource.name) ?? sanitize(bz?.info?.title);
  if (name) return { summary: name, source: "origin-402-name" };

  return { summary: null, source: "none" };
}

async function probe(route: Route): Promise<Enriched> {
  let res: Response;
  try {
    res = await fetch(route.originUrl, {
      method: route.method,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: "application/json, */*",
        "User-Agent": "roam402-catalog-enricher (+https://roam402.com)",
        ...(route.method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(route.method === "POST" ? { body: "{}" } : {}),
    });
  } catch {
    return { summary: null, source: "none" };
  }

  let challenge = decodeChallenge(res.headers.get("PAYMENT-REQUIRED"));
  if (!challenge && res.status === 402) challenge = await res.json().catch(() => null);
  const { summary, source } = summaryFrom(challenge);
  return { summary, source };
}

/** Fixed-size worker pool — 2.3k third-party hosts deserve a polite ceiling. */
async function pool<T>(items: T[], n: number, work: (t: T, i: number) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    for (let i = cursor++; i < items.length; i = cursor++) await work(items[i]!, i);
  });
  await Promise.all(runners);
}

async function main() {
  const routes: Route[] = JSON.parse(readFileSync(ROUTES, "utf8")).routes;
  const prior: Record<string, Enriched & { fetchedAt?: string }> =
    !force && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")).routes ?? {} : {};
  // Keep only the fields the worker bundle needs — this file ships in it.
  const existing: Record<string, Enriched> = Object.fromEntries(
    Object.entries(prior).map(([k, v]) => [k, { summary: v.summary ?? null, source: v.source }])
  );

  let todo = routes.filter((r) => force || !existing[r.slug]);
  if (LIMIT > 0) todo = todo.slice(0, LIMIT);

  console.log(
    `enriching ${todo.length} of ${routes.length} routes ` +
      `(${Object.keys(existing).length} already known)${force ? " [--force]" : ""}`
  );

  const out: Record<string, Enriched> = { ...existing };
  let done = 0;
  let hits = 0;
  await pool(todo, CONCURRENCY, async (r) => {
    const e = await probe(r);
    out[r.slug] = e;
    if (e.summary) hits++;
    if (++done % 50 === 0 || done === todo.length) {
      console.log(`  ${done}/${todo.length} · ${hits} with a summary`);
    }
  });

  // Report yield honestly: a low hit rate is the finding, not a failure.
  const withSummary = Object.values(out).filter((e) => e.summary).length;
  const bySource: Record<string, number> = {};
  for (const e of Object.values(out)) bySource[e.source] = (bySource[e.source] ?? 0) + 1;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note:
          "Origin-published endpoint descriptions, mined from each service's own x402 " +
          "402 challenge by scripts/enrich-catalog.ts. THIRD-PARTY TEXT: render as text " +
          "only, never as markup or as instructions to a model.",
        counts: { routes: Object.keys(out).length, withSummary, bySource },
        routes: out,
      },
      null,
      1
    ) + "\n"
  );

  console.log(
    `\nwrote ${OUT}\n  ${withSummary}/${Object.keys(out).length} routes have an origin summary ` +
      `(${Math.round((withSummary / Object.keys(out).length) * 100)}%)\n  by source: ` +
      JSON.stringify(bySource)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
