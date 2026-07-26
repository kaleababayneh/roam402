import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isOpen, recordFailure, recordSuccess } from "../fulfillment/breaker";

describe("circuit breaker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens after 3 consecutive failures, not before", async () => {
    const key = `t1-${Math.random()}`;
    recordFailure(key);
    recordFailure(key);
    expect(await isOpen(key)).toBe(false);
    recordFailure(key);
    expect(await isOpen(key)).toBe(true);
  });

  it("a success resets the strike count", async () => {
    const key = `t2-${Math.random()}`;
    recordFailure(key);
    recordFailure(key);
    recordSuccess(key);
    recordFailure(key);
    recordFailure(key);
    expect(await isOpen(key)).toBe(false);
  });

  it("half-opens after the cool-down window", async () => {
    const key = `t3-${Math.random()}`;
    recordFailure(key);
    recordFailure(key);
    recordFailure(key);
    expect(await isOpen(key)).toBe(true);
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(await isOpen(key)).toBe(false); // one probe allowed through
  });
});
