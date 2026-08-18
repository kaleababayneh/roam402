/**
 * src/fulfillment/health.ts — the self-healing catalog.
 *
 * A cron sweep probes origins UNPAID: an HTTP 402 reply is positive proof the
 * endpoint is alive AND speaking x402 — no money spent. Verdicts persist to KV;
 * the request-path guard consults them and refuses (503, before any payment)
 * routes whose origin is confidently down.
 *
 * Status model:
 *   "live"      → answered 402 (x402-speaking)            → serve
 *   "reachable" → answered non-402 (alive, protocol odd)  → serve, flagged
 *   "down"      → the ORIGIN failed us (5xx, timeout,
 *                 DNS, connection refused)                → serve until it
 *                                                           fails twice, then
 *                                                           refuse
 * No KV binding → feature inert (serve everything, as before).
 *
 * TWO RULES LEARNED THE HARD WAY, both of which were costing real sales:
 *
 * 1. A probe that WE could not complete is not evidence about the origin.
 *    Workers cap subrequests per invocation, and KV operations count toward
 *    that cap too. The old sweep probed 200 routes per run, blew the cap
 *    around the 46th, and every fetch after it threw instantly — which the
 *    catch block recorded as "down". Result: 154 of 200 routes marked dead
 *    per run and refused before payment, while an independent probe of the
 *    same slice found them alive. The sweep now stops the moment it detects
 *    exhaustion, leaves the unprobed routes' previous verdicts untouched, and
 *    resumes there next run — which self-tunes to whatever the real cap is.
 *
 * 2. One bad probe is not a dead origin. A verdict only refuses traffic after
 *    MIN_FAILS consecutive failures, so a single blip cannot take a seller
 *    offline.
 */

import { catalog } from "../catalog";
import { log } from "../lib/log";

const PROBE_TIMEOUT_MS = 8_000;
const CONCURRENCY = 5;
/** Upper bound per invocation. The real limit is discovered at runtime — the
 *  sweep stops early when the platform says it is out of subrequests. */
const SLICE_SIZE = 120;
/** Consecutive failed probes before a route is refused before payment. */
const MIN_FAILS = 2;
const KEY_PREFIX = "health:route:";
const KEY_SUMMARY = "health:summary";
const KEY_CURSOR = "health:cursor";
/** Compact list of confidently-down slugs — one read serves the whole catalog. */
const KEY_DOWN = "health:down";
/** A stale verdict must not refuse traffic forever. */
const VERDICT_TTL_MS = 48 * 60 * 60 * 1000;

export type OriginStatus = "live" | "reachable" | "down";

export interface RouteHealth {
  status: OriginStatus;
  httpStatus: number | null;
  at: string;
  /** Consecutive failures. Only >= MIN_FAILS refuses traffic. */
  fails?: number;
}

export interface HealthSummary {
  at: string;
  live: number;
  reachable: number;
  down: number;
  /** Which rotating slice this run covered, e.g. "200-320/2349". */
  slice?: string;
  /** Routes in the slice we never got to (budget ran out) — NOT failures. */
  skipped?: number;
  /** True when the platform cut us off; the cursor rewinds to resume here. */
  exhausted?: boolean;
  /** How many routes are currently refused before payment. */
  refusing?: number;
}

/** Probe outcome, separating "the origin failed" from "we failed". */
type Probe =
  | { kind: "verdict"; status: OriginStatus; httpStatus: number | null }
  | { kind: "unknown" };

/**
 * Cloudflare signals subrequest exhaustion through the error message. Anything
 * matching is OUR limit, never the origin's fault — the caller stops the sweep
 * rather than blaming the endpoints it never reached.
 */
function isBudgetError(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    m.includes("too many subrequests") ||
    m.includes("subrequest limit") ||
    m.includes("exceeded the limit") ||
    m.includes("cpu time limit")
  );
}

async function probeOrigin(url: string, method: "GET" | "POST"): Promise<Probe> {
  try {
    const res = await fetch(url, {
      method,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { Accept: "application/json, */*" },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    if (res.status === 402) return { kind: "verdict", status: "live", httpStatus: 402 };
    if (res.status >= 500) return { kind: "verdict", status: "down", httpStatus: res.status };
    return { kind: "verdict", status: "reachable", httpStatus: res.status };
  } catch (err) {
    // Out of budget → we learned nothing about this origin. A timeout or a
    // connection failure, on the other hand, IS about the origin.
    if (isBudgetError(err)) return { kind: "unknown" };
    return { kind: "verdict", status: "down", httpStatus: null };
  }
}

/**
 * Probe the next slice of catalog origins, persist verdicts, advance the
 * rotating cursor. Stops early and rewinds the cursor if the platform cuts us
 * off, so the next run resumes at the first unprobed route.
 */
export async function runHealthSweep(kv: KVNamespace): Promise<HealthSummary> {
  let cursor = 0;
  try {
    cursor = Number((await kv.get(KEY_CURSOR)) ?? 0) || 0;
  } catch {
    /* start at 0 */
  }
  const all = catalog.routes;
  const routes = all.slice(cursor, cursor + SLICE_SIZE);

  const results = new Map<string, RouteHealth>();
  let exhausted = false;
  let probed = 0;
  let i = 0;

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, routes.length) }, async () => {
      while (i < routes.length && !exhausted) {
        const route = routes[i++];
        if (!route) break;
        const probe = await probeOrigin(route.originUrl, route.method);
        if (probe.kind === "unknown") {
          // Budget gone: stop every worker. Whatever we did not reach keeps
          // the verdict it already had.
          exhausted = true;
          break;
        }
        probed += 1;
        const prior = await readHealth(kv, route.slug);
        const failing = probe.status === "down";
        results.set(route.slug, {
          status: probe.status,
          httpStatus: probe.httpStatus,
          at: new Date().toISOString(),
          fails: failing ? (prior?.fails ?? 0) + 1 : 0,
        });
      }
    })
  );

  // Resume where we stopped; only wrap once the whole slice was covered.
  const advanced = cursor + probed;
  const nextCursor = advanced >= all.length ? 0 : advanced;
  await kv.put(KEY_CURSOR, String(nextCursor)).catch(() => {});

  const summary: HealthSummary = {
    at: new Date().toISOString(),
    live: 0,
    reachable: 0,
    down: 0,
    slice: `${cursor}-${cursor + probed}/${all.length}`,
    skipped: routes.length - probed,
    exhausted,
  };
  for (const [slug, health] of results) {
    summary[health.status] += 1;
    await kv.put(`${KEY_PREFIX}${slug}`, JSON.stringify(health)).catch(() => {});
  }

  summary.refusing = await updateDownList(kv, results);
  await kv.put(KEY_SUMMARY, JSON.stringify(summary)).catch(() => {});
  log("health_sweep", { ...summary });
  return summary;
}

async function readHealth(kv: KVNamespace, slug: string): Promise<RouteHealth | null> {
  try {
    const raw = await kv.get(`${KEY_PREFIX}${slug}`);
    return raw ? (JSON.parse(raw) as RouteHealth) : null;
  } catch {
    return null;
  }
}

/**
 * Maintain the compact refusal list. Discovery surfaces read this ONCE to know
 * what not to recommend — 2,349 individual reads is not an option on the
 * request path.
 */
async function updateDownList(kv: KVNamespace, fresh: Map<string, RouteHealth>): Promise<number> {
  let list: string[] = [];
  try {
    list = JSON.parse((await kv.get(KEY_DOWN)) ?? "[]") as string[];
  } catch {
    /* rebuild from this slice alone */
  }
  const set = new Set(list);
  for (const [slug, h] of fresh) {
    if (h.status === "down" && (h.fails ?? 0) >= MIN_FAILS) set.add(slug);
    else set.delete(slug); // recovered, or not yet confirmed
  }
  const next = [...set];
  await kv.put(KEY_DOWN, JSON.stringify(next)).catch(() => {});
  return next.length;
}

/** Slugs currently refused before payment. One KV read; safe to call per request. */
export async function getDownSlugs(kv: KVNamespace | undefined): Promise<Set<string>> {
  if (!kv) return new Set();
  try {
    const raw = await kv.get(KEY_DOWN, { cacheTtl: 300 });
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/**
 * Guard check: true → refuse before payment.
 *
 * Deliberately conservative. A route is refused only when the origin failed us
 * MIN_FAILS times in a row and the verdict is fresh. Anything less — one blip,
 * a stale verdict, an unreadable record — sells.
 */
export async function isOriginDown(kv: KVNamespace | undefined, slug: string): Promise<boolean> {
  if (!kv) return false;
  try {
    const raw = await kv.get(`${KEY_PREFIX}${slug}`);
    if (!raw) return false;
    const h = JSON.parse(raw) as RouteHealth;
    if (Date.now() - Date.parse(h.at) > VERDICT_TTL_MS) return false;
    return h.status === "down" && (h.fails ?? 0) >= MIN_FAILS;
  } catch {
    return false;
  }
}

/** Read a route's last probe verdict (null = never probed / no KV). */
export async function getRouteHealth(
  kv: KVNamespace | undefined,
  slug: string
): Promise<RouteHealth | null> {
  if (!kv) return null;
  return readHealth(kv, slug);
}

export async function getHealthSummary(kv: KVNamespace | undefined): Promise<HealthSummary | null> {
  if (!kv) return null;
  try {
    const raw = await kv.get(KEY_SUMMARY);
    return raw ? (JSON.parse(raw) as HealthSummary) : null;
  } catch {
    return null;
  }
}

export const HEALTH_INTERNALS = { MIN_FAILS, SLICE_SIZE, isBudgetError };
