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

/** True → refuse the request before taking payment. */
export function isOpen(key: string): boolean {
  const s = state(key);
  if (s.openedAt === null) return false;
  if (Date.now() - s.openedAt > COOL_MS) return false; // half-open: allow a probe
  return true;
}

export function recordSuccess(key: string): void {
  states.set(key, { failures: 0, openedAt: null });
}

export function recordFailure(key: string): void {
  const s = state(key);
  s.failures += 1;
  if (s.failures >= THRESHOLD) s.openedAt = Date.now();
}
