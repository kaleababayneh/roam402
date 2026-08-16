import { describe, it, expect } from "vitest";
import { catalog } from "../catalog";
import { routeLabel, originSummary } from "../lib/routeText";
import enrichmentJson from "../../catalog/enrichment.json";

/**
 * catalog/enrichment.json holds THIRD-PARTY text mined from origins, and it is
 * a committed artifact that can drift out of step with the route table. These
 * tests hold both properties: the text stays safe to carry, and the sidecar
 * stays aligned with the catalog it describes.
 */

const enrichment = enrichmentJson as {
  routes: Record<string, { summary: string | null; source: string }>;
};
const entries = Object.entries(enrichment.routes);
const slugs = new Set(catalog.routes.map((r) => r.slug));

describe("catalog enrichment", () => {
  it("describes routes that exist — no orphans after a census regen", () => {
    const orphans = entries.filter(([slug]) => !slugs.has(slug)).map(([s]) => s);
    expect(orphans.slice(0, 10)).toEqual([]);
  });

  it("covers the whole catalog", () => {
    const missing = catalog.routes.filter((r) => !enrichment.routes[r.slug]).map((r) => r.slug);
    // If this fails the catalog grew: run `pnpm catalog:enrich` (idempotent —
    // it only probes what is missing) and commit the sidecar.
    expect(missing.slice(0, 10), `${missing.length} routes unprobed`).toEqual([]);
  });

  it("mined text is sanitised: single line, no control chars, length capped", () => {
    for (const [slug, e] of entries) {
      if (e.summary == null) continue;
      expect(typeof e.summary, slug).toBe("string");
      expect(e.summary.length, slug).toBeGreaterThan(0);
      expect(e.summary.length, slug).toBeLessThanOrEqual(240);
      expect(/[\u0000-\u001f\u007f]/.test(e.summary), `${slug} has control chars`).toBe(false);
      expect(e.summary, slug).toBe(e.summary.trim());
    }
  });

  it("records how each summary was learned", () => {
    for (const [slug, e] of entries) {
      expect(["origin-402", "origin-402-name", "none"], slug).toContain(e.source);
      if (e.source === "none") expect(e.summary, slug).toBeNull();
    }
  });

  it("actually enriched a meaningful share of the catalog", () => {
    const withSummary = entries.filter(([, e]) => e.summary).length;
    // Yield is uneven by nature (some origins publish nothing), but a collapse
    // to near-zero means the probe broke, not that the ecosystem changed.
    expect(withSummary).toBeGreaterThan(entries.length * 0.2);
  });

  it("routeLabel prefers the origin's own description over the census one", () => {
    const hit = catalog.routes.find((r) => originSummary(r.slug));
    expect(hit, "expected at least one enriched route").toBeTruthy();
    expect(routeLabel(hit!.description, hit!.slug)).toBe(originSummary(hit!.slug));
  });

  it("routeLabel still falls back when nothing was mined", () => {
    const miss = catalog.routes.find((r) => !originSummary(r.slug));
    if (!miss) return; // full coverage is a fine outcome
    const label = routeLabel(miss.description, miss.slug);
    expect(label).not.toContain("via Roam402");
    expect(label.length).toBeGreaterThan(0);
  });
});
