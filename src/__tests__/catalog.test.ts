import { describe, it, expect } from "vitest";
import { catalog, findRoute, testRoute, TEST_ROUTE_SLUG } from "../catalog";

describe("catalog integrity", () => {
  it("has routes, all with parity pricing and valid shapes", () => {
    expect(catalog.routes.length).toBeGreaterThanOrEqual(40);
    for (const r of catalog.routes) {
      expect(r.roamPriceUsd).toBe(r.originPriceUsd); // traction pricing
      expect(r.slug).toMatch(/^[a-z0-9-]+$/);
      expect(["GET", "POST"]).toContain(r.method);
      expect(r.originUrl.startsWith("https://")).toBe(true); // https-normalised
      expect(r.description.length).toBeGreaterThan(20);
    }
  });

  it("has unique slugs", () => {
    const slugs = catalog.routes.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("resolves catalog slugs and rejects unknowns", () => {
    const first = catalog.routes[0]!;
    expect(findRoute(first.slug)?.originUrl).toBe(first.originUrl);
    expect(findRoute("no-such-route")).toBeUndefined();
  });

  it("injects the loop-test route ONLY when a test origin is configured", () => {
    expect(findRoute(TEST_ROUTE_SLUG)).toBeUndefined();
    const injected = findRoute(TEST_ROUTE_SLUG, "http://localhost:8988/paid-data");
    expect(injected?.originUrl).toBe("http://localhost:8988/paid-data");
    expect(testRoute(undefined)).toBeUndefined();
  });
});
