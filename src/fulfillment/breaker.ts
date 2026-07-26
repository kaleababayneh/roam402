/**
 * src/fulfillment/breaker.ts — per-route circuit breaker.
 *
 * Opens after N consecutive origin failures; half-opens after COOL_MS so one
 * probe request can close it again. In-memory per isolate — deliberately
 * simple: a blown breaker's job is to stop us charging buyers for a dead
 * origin *right now*, not to be a distributed consensus system.
 */

const THRESHOLD = 3;
const COOL_MS = 5 * 60 * 1000;

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

const states = new Map<string, BreakerState>();

function state(key: string): BreakerState {
  let s = states.get(key);
  if (!s) {
    s = { failures: 0, openedAt: null };
    states.set(key, s);
  }
  return s;
}

const KV_PREFIX = "breaker:";
/** KV TTL = the cool-down: the key expiring IS the half-open transition. */
const KV_TTL_S = Math.ceil(COOL_MS / 1000);

/** True → refuse the request before taking payment.
 *  Memory-first; falls back to KV so trips survive isolate recycling. */
export async function isOpen(key: string, kv?: KVNamespace): Promise<boolean> {
  const s = state(key);
  if (s.openedAt !== null && Date.now() - s.openedAt <= COOL_MS) return true;
  if (!kv) return false;
  try {
    return (await kv.get(`${KV_PREFIX}${key}`)) !== null;
  } catch {
    return false;
  }
}

export function recordSuccess(key: string, kv?: KVNamespace): void {
  states.set(key, { failures: 0, openedAt: null });
  if (kv) void kv.delete(`${KV_PREFIX}${key}`).catch(() => {});
}

export function recordFailure(key: string, kv?: KVNamespace): void {
  const s = state(key);
  s.failures += 1;
  if (s.failures >= THRESHOLD) {
    s.openedAt = Date.now();
    if (kv) void kv.put(`${KV_PREFIX}${key}`, String(s.openedAt), { expirationTtl: KV_TTL_S }).catch(() => {});
  }
}

/** Currently-open trips in this isolate (for /healthz). */
export function openTripCount(): number {
  let n = 0;
  for (const s of states.values()) {
    if (s.openedAt !== null && Date.now() - s.openedAt <= COOL_MS) n++;
  }
  return n;
}
