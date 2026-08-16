import { describe, it, expect } from "vitest";
import { catalogPayload, queryFromRequest, DEFAULT_LIMIT, MAX_LIMIT } from "../routes/free";
import { catalog } from "../catalog";
import { CHAINS } from "../config";
import type { Config } from "../config";

/**
 * The catalog is consumed by agents with finite context windows, so the size
 * of a default response is a correctness property, not a preference. These
 * tests pin the paging contract that keeps it small and complete.
 */

const cfg = {
  network: "mainnet",
  chain: CHAINS.mainnet,
  payTo: "X".repeat(58),
  facilitatorUrl: "https://facilitator.goplausible.xyz",
  killSwitch: false,
  perRequestCapUsd: 1,
  publicBaseUrl: "https://roam402.com",
} as Config;

const q = (params: Record<string, string>) =>
  queryFromRequest({ query: (k: string) => params[k] });

type Payload = {
  wrapped: {
    path: string;
    description: string;
    category: string;
    trust_tier: string;
    method: string;
    price: string;
  }[];
  total: number;
  returned: number;
  offset: number;
  next: string | null;
  stats: { routes: number; services: number };
};

const call = (params: Record<string, string> = {}) =>
  catalogPayload(cfg, q(params)) as unknown as Payload;

describe("catalog paging", () => {
  it("defaults to one small page, not the whole table", () => {
    const p = call();
    expect(p.returned).toBe(DEFAULT_LIMIT);
    expect(p.total).toBe(catalog.routes.length);
    // The guard that matters: a default response must stay context-sized.
    expect(JSON.stringify(p).length).toBeLessThan(20_000);
  });

  it("exposes every route through next, with no gaps or repeats", () => {
    const seen: string[] = [];
    for (let offset = 0; offset < 200; offset += 50) {
      const p = call({ limit: "50", offset: String(offset) });
      expect(p.offset).toBe(offset);
      seen.push(...p.wrapped.map((w) => w.path));
    }
    expect(seen.length).toBe(200);
    expect(new Set(seen).size).toBe(200);
    // …and matches a straight slice of the catalog.
    expect(seen[0]).toBe(`/r/${catalog.routes[0]!.slug}`);
    expect(seen[199]).toBe(`/r/${catalog.routes[199]!.slug}`);
  });

  it("stops offering next on the last page", () => {
    const total = catalog.routes.length;
    expect(call({ limit: "50", offset: String(total - 10) }).next).toBeNull();
    expect(call({ limit: "50", offset: "0" }).next).toContain("offset=50");
  });

  it("clamps limit and ignores junk, but honours limit=all", () => {
    expect(call({ limit: "9999" }).returned).toBe(MAX_LIMIT);
    expect(call({ limit: "0" }).returned).toBe(DEFAULT_LIMIT);
    expect(call({ limit: "banana" }).returned).toBe(DEFAULT_LIMIT);
    expect(call({ limit: "all" }).returned).toBe(catalog.routes.length);
  });

  it("drops the boilerplate tail every route repeats", () => {
    for (const w of call({ limit: "100" }).wrapped) {
      expect(w.description, w.path).not.toContain("via Roam402");
      expect(w.description, w.path).not.toContain("dual-chain receipts");
      expect(w.description.length, w.path).toBeGreaterThan(0);
    }
  });

  it("reports full-catalog stats regardless of the page", () => {
    const p = call({ limit: "1", category: "ai_inference" });
    expect(p.returned).toBe(1);
    expect(p.stats.routes).toBe(catalog.routes.length);
    expect(p.stats.services).toBe(new Set(catalog.routes.map((r) => r.service)).size);
  });

  it("filters narrow the total, so paging follows the filter", () => {
    const all = call();
    const one = call({ category: "ai_inference" });
    expect(one.total).toBeLessThan(all.total);
    expect(one.total).toBeGreaterThan(0);
    for (const w of one.wrapped) expect(w.category).toBe("ai_inference");
  });

  it("supports tier, method and max_price filters", () => {
    for (const w of call({ tier: "corroborated", limit: "50" }).wrapped)
      expect(w.trust_tier).toBe("Corroborated");
    for (const w of call({ method: "post", limit: "50" }).wrapped) expect(w.method).toBe("POST");
    for (const w of call({ max_price: "0.001", limit: "50" }).wrapped)
      expect(Number(w.price.replace("$", ""))).toBeLessThanOrEqual(0.001);
  });
});
