/**
 * src/fulfillment/health.ts — the self-healing catalog.
 *
 * A cron sweep probes every origin UNPAID: an HTTP 402 reply is positive
 * proof the endpoint is alive AND speaking x402 — no money spent. Results
 * persist to KV; the request-path guard consults them and refuses (503,
 * before any payment) routes whose origin was down on the last sweep.
 *
 * Status model:
 *   "live"      → answered 402 (x402-speaking)            → serve
 *   "reachable" → answered non-402 (alive, protocol odd)  → serve, flagged
 *   "down"      → network error / timeout / 5xx           → refuse
 * No KV binding → feature inert (serve everything, as before).
 */

import { catalog } from "../catalog";
import { log } from "../lib/log";

const PROBE_TIMEOUT_MS = 8_000;
const CONCURRENCY = 5;
/** Routes probed per cron invocation — the full catalog is swept in rotating
 *  slices so a single scheduled run stays well inside Workers limits.
 *  2,300 routes ÷ 200 per run × 30-min cron ≈ full sweep every ~6h; the
 *  guard's 24h verdict TTL tolerates that comfortably. */
const SLICE_SIZE = 200;
const KEY_PREFIX = "health:route:";
const KEY_SUMMARY = "health:summary";
const KEY_CURSOR = "health:cursor";
/** A stale verdict must not refuse traffic forever. */
const VERDICT_TTL_MS = 24 * 60 * 60 * 1000;

export type OriginStatus = "live" | "reachable" | "down";

export interface RouteHealth {
  status: OriginStatus;
  httpStatus: number | null;
  at: string;
}

export interface HealthSummary {
  at: string;
  live: number;
  reachable: number;
  down: number;
  /** Which rotating slice this run covered, e.g. "200-400/2300". */
  slice?: string;
}

async function probeOrigin(url: string, method: "GET" | "POST"): Promise<RouteHealth> {
  const at = new Date().toISOString();
  try {
    const res = await fetch(url, {
      method,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { Accept: "application/json, */*" },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    if (res.status === 402) return { status: "live", httpStatus: 402, at };
    if (res.status >= 500) return { status: "down", httpStatus: res.status, at };
    return { status: "reachable", httpStatus: res.status, at };
  } catch {
    return { status: "down", httpStatus: null, at };
  }
}

/** Probe the next SLICE of catalog origins (bounded concurrency), persist
 *  verdicts, advance the rotating cursor. */
export async function runHealthSweep(kv: KVNamespace): Promise<HealthSummary> {
  let cursor = 0;
  try {
    cursor = Number((await kv.get(KEY_CURSOR)) ?? 0) || 0;
  } catch { /* start at 0 */ }
  const all = catalog.routes;
  const routes = all.slice(cursor, cursor + SLICE_SIZE);
  const nextCursor = cursor + SLICE_SIZE >= all.length ? 0 : cursor + SLICE_SIZE;
  await kv.put(KEY_CURSOR, String(nextCursor)).catch(() => {});
  const results = new Map<string, RouteHealth>();

  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, routes.length) }, async () => {
      while (i < routes.length) {
        const route = routes[i++];
        if (!route) break;
        results.set(route.slug, await probeOrigin(route.originUrl, route.method));
      }
    })
  );

  const summary: HealthSummary = {
    at: new Date().toISOString(),
    live: 0,
    reachable: 0,
    down: 0,
    slice: `${cursor}-${cursor + routes.length}/${all.length}`,
  };
  for (const [slug, health] of results) {
    summary[health.status] += 1;
    await kv.put(`${KEY_PREFIX}${slug}`, JSON.stringify(health));
  }
  await kv.put(KEY_SUMMARY, JSON.stringify(summary));
  log("health_sweep", { ...summary });
  return summary;
}

/** Guard check: true → refuse before payment. Fresh "down" verdicts only. */
export async function isOriginDown(kv: KVNamespace | undefined, slug: string): Promise<boolean> {
  if (!kv) return false;
  try {
    const raw = await kv.get(`${KEY_PREFIX}${slug}`);
    if (!raw) return false;
    const h = JSON.parse(raw) as RouteHealth;
    if (Date.now() - Date.parse(h.at) > VERDICT_TTL_MS) return false;
    return h.status === "down";
  } catch {
    return false;
  }
}

/** Read a route's last probe verdict (null = never probed / no KV). */
export async function getRouteHealth(kv: KVNamespace | undefined, slug: string): Promise<RouteHealth | null> {
  if (!kv) return null;
  try {
    const raw = await kv.get(`${KEY_PREFIX}${slug}`);
    return raw ? (JSON.parse(raw) as RouteHealth) : null;
  } catch {
    return null;
  }
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
