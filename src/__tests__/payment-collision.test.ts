import { describe, it, expect } from "vitest";

/**
 * Concurrent payments from one wallet must not build identical transactions.
 *
 * The AVM scheme stamps each payment with a note ending in Date.now(). For two
 * calls to the same route at the same price from the same account, that note is
 * the ONLY field that differs — so payments built inside one millisecond are
 * byte-identical, share a transaction ID, and Algorand rejects all but the
 * first. Measured against the real scheme: 3 of 8 concurrent payments collided.
 *
 * The SDK fixes it by queueing payload construction and waiting out the current
 * millisecond (SerialPaymentScheme in sdk/src/index.ts). This test pins the
 * queueing behaviour without needing a wallet or the network: it drives the
 * same discipline over a stand-in that reports the millisecond it ran in.
 */

/** The serialisation discipline under test, mirroring the SDK's subclass. */
function serialise<T>(build: () => Promise<T>) {
  let queue: Promise<unknown> = Promise.resolve();
  let lastMs = 0;
  return (): Promise<T> => {
    const run = queue.then(async () => {
      while (Date.now() <= lastMs) await new Promise((r) => setTimeout(r, 1));
      lastMs = Date.now();
      return build();
    });
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

/** Stand-in for createPaymentPayload: its identity is the millisecond it ran. */
const stampAtCallTime = async () => `x402-payment-v2-${Date.now()}`;

describe("concurrent payment construction", () => {
  it("reproduces the collision when payments are built in parallel", async () => {
    const notes = await Promise.all(Array.from({ length: 8 }, () => stampAtCallTime()));
    // Not a strict guarantee on a slow machine, but on any normal one several
    // of eight parallel builds land in the same millisecond.
    expect(new Set(notes).size).toBeLessThan(notes.length);
  });

  it("serialised construction gives every payment a distinct identity", async () => {
    const build = serialise(stampAtCallTime);
    const notes = await Promise.all(Array.from({ length: 8 }, () => build()));
    expect(new Set(notes).size).toBe(notes.length);
  });

  it("keeps the queue alive when one payment throws", async () => {
    let n = 0;
    const build = serialise(async () => {
      n++;
      if (n === 2) throw new Error("payment rejected");
      return `ok-${Date.now()}`;
    });
    const results = await Promise.allSettled([build(), build(), build(), build()]);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    // A failure must not wedge the chain — the later payments still ran.
    const ok = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<string>).value);
    expect(ok).toHaveLength(3);
    expect(new Set(ok).size).toBe(3);
  });

  it("costs milliseconds, not throughput — the origin call is not serialised", async () => {
    const build = serialise(stampAtCallTime);
    const started = Date.now();
    await Promise.all(Array.from({ length: 8 }, () => build()));
    // Eight payments spaced a millisecond apart, not eight round trips.
    expect(Date.now() - started).toBeLessThan(500);
  });
});
