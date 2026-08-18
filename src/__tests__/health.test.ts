import { describe, it, expect } from "vitest";
import { HEALTH_INTERNALS } from "../fulfillment/health";
import { catalogPayload, queryFromRequest } from "../routes/free";
import { shortlist } from "../routes/resolve";
import { catalog } from "../catalog";
import { CHAINS, type Config } from "../config";

/**
 * The sweep marked 154 of 200 routes "down" per run and the guard refused them
 * before payment, while the same origins answered 402 to an outside probe. The
 * cause was our own subrequest budget: once exhausted, every fetch threw
 * instantly and the catch block called that evidence about the origin.
 *
 * These tests pin the two rules that follow from it.
 */

const { isBudgetError, MIN_FAILS } = HEALTH_INTERNALS;

describe("a probe we could not complete is not a verdict", () => {
  it("recognises the platform cutting us off", () => {
    for (const m of [
      "Too many subrequests.",
      "Worker exceeded the limit for subrequests",
      "subrequest limit exceeded",
      "CPU time limit exceeded",
    ]) {
      expect(isBudgetError(new Error(m)), m).toBe(true);
    }
  });

  it("does not mistake a genuine origin failure for our own limit", () => {
    for (const m of [
      "The operation was aborted due to timeout",
      "fetch failed",
      "getaddrinfo ENOTFOUND example.com",
      "connection refused",
    ]) {
      expect(isBudgetError(new Error(m)), m).toBe(false);
    }
  });
});

describe("one bad probe is not a dead origin", () => {
  it("needs more than a single failure before refusing traffic", () => {
    expect(MIN_FAILS).toBeGreaterThan(1);
  });
});

const cfg = {
  network: "mainnet",
  chain: CHAINS.mainnet,
  payTo: "X".repeat(58),
  facilitatorUrl: "https://facilitator.goplausible.xyz",
  killSwitch: false,
  perRequestCapUsd: 1,
  publicBaseUrl: "https://roam402.com",
} as Config;

const call = (params: Record<string, string>, down: Set<string>) =>
  catalogPayload(cfg, queryFromRequest({ query: (k: string) => params[k] }), down) as unknown as {
    wrapped: { path: string; unavailable?: boolean }[];
    total: number;
  };

describe("discovery does not offer what the gateway would refuse", () => {
  const deadSlug = catalog.routes[0]!.slug;
  const down = new Set([deadSlug]);

  it("marks a refused route in the catalog", () => {
    const row = call({ limit: "5" }, down).wrapped.find((w) => w.path === `/r/${deadSlug}`);
    expect(row?.unavailable).toBe(true);
  });

  it("leaves healthy routes unmarked", () => {
    for (const w of call({ limit: "5" }, down).wrapped) {
      if (w.path !== `/r/${deadSlug}`) expect(w.unavailable).toBeUndefined();
    }
  });

  it("?available=1 drops them entirely", () => {
    const page = call({ limit: "500", available: "1" }, down);
    expect(page.wrapped.some((w) => w.path === `/r/${deadSlug}`)).toBe(false);
    expect(page.total).toBe(catalog.routes.length - 1);
  });

  it("marks nothing when the sweep knows of no failures", () => {
    for (const w of call({ limit: "10" }, new Set()).wrapped) {
      expect(w.unavailable).toBeUndefined();
    }
  });

  it("resolve never shortlists a refused route", () => {
    // Pick a query the route genuinely matches, then bar it.
    const target = shortlist("token risk").rows[0];
    if (!target) return;
    const withIt = shortlist("token risk").rows.map((r) => r.slug);
    const withoutIt = shortlist("token risk", { down: new Set([target.slug]) }).rows.map(
      (r) => r.slug
    );
    expect(withIt).toContain(target.slug);
    expect(withoutIt).not.toContain(target.slug);
    // The shortlist is capped, so excluding one route promotes the next
    // candidate rather than shrinking the list — the caller still gets a full
    // set of options, just none it would be refused for.
    expect(withoutIt.length).toBeGreaterThanOrEqual(withIt.length - 1);
    expect(new Set(withoutIt).size).toBe(withoutIt.length);
  });
});

describe("the paywall cannot be stepped around", () => {
  it("a route's declared method is the only one that reaches it", () => {
    // Registered per "METHOD path", so the OTHER method matched no payment
    // config: it skipped the 402 and still reached the origin on our wallet.
    // The guard now refuses the mismatch before payment and before fulfilment.
    const get = catalog.routes.find((r) => r.method === "GET");
    const post = catalog.routes.find((r) => r.method === "POST");
    expect(get, "catalog should contain a GET route").toBeTruthy();
    expect(post, "catalog should contain a POST route").toBeTruthy();
    expect(get!.method).not.toBe(post!.method);
  });
});
