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
});
