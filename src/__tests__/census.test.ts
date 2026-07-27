import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { censusRows, _resetCensusCache } from "../lib/census";

const ok = (rows: unknown[]): Response =>
  new Response(JSON.stringify({ data: rows }), { status: 200 });

describe("census cache", () => {
  beforeEach(() => {
    _resetCensusCache();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("fetches once within the TTL", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok([{ domain: "a.io" }]));
    await censusRows();
    await censusRows();
    await censusRows();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("refetches after the TTL expires", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok([{ domain: "a.io" }]));
    await censusRows();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await censusRows();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("serves STALE data when upstream fails after a good snapshot", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok([{ domain: "a.io" }]))
      .mockRejectedValueOnce(new Error("upstream down"));
    await censusRows();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const second = await censusRows();
    expect(second.stale).toBe(true);
    expect(second.rows[0]?.domain).toBe("a.io");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("throws when upstream fails with no snapshot to fall back to", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    await expect(censusRows()).rejects.toThrow();
  });

  // The 2026-07-26 agents-trust outage scenario: isolate recycled mid-outage.
  it("cold isolate serves the KV snapshot when upstream is down", async () => {
    const store = new Map<string, string>();
    const kv = {
      put: async (k: string, v: string) => void store.set(k, v),
      get: async (k: string) => {
        const v = store.get(k);
        return v ? JSON.parse(v) : null;
      },
    } as unknown as KVNamespace;

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok([{ domain: "a.io" }]));
    await censusRows(kv); // healthy fetch writes the snapshot
    expect(store.has("census:snapshot")).toBe(true);

    _resetCensusCache(); // isolate recycled
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("upstream down"));
    const revived = await censusRows(kv);
    expect(revived.stale).toBe(true);
    expect(revived.rows[0]?.domain).toBe("a.io");

    // …and without KV the same cold isolate would have thrown.
    _resetCensusCache();
    await expect(censusRows()).rejects.toThrow();
  });
});
