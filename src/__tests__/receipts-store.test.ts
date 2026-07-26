import { describe, it, expect } from "vitest";
import { makeReceiptStore, type ReceiptEntry } from "../receipts/store";

/** Minimal in-memory KV satisfying the two methods the store uses. */
function fakeKv(): KVNamespace {
  const m = new Map<string, string>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
  } as unknown as KVNamespace;
}

const entry = (route: string): ReceiptEntry => ({
  ts: "2026-07-26T00:00:00Z",
  route,
  service: "svc",
  method: "GET",
  priceUsd: 0.001,
  originReceipt: "0xabc",
  originChain: "eip155:84532",
});

describe("receipt store", () => {
  it("is inert without a KV binding — never throws", async () => {
    const store = makeReceiptStore(undefined);
    expect(store.enabled).toBe(false);
    await store.record(entry("/r/a"));
    expect(await store.list()).toEqual([]);
  });

  it("records newest-first and caps retention", async () => {
    const store = makeReceiptStore(fakeKv());
    for (let i = 0; i < 205; i++) await store.record(entry(`/r/${i}`));
    const list = await store.list();
    expect(list).toHaveLength(200);
    expect(list[0]!.route).toBe("/r/204");
  });

  it("swallows KV failures — receipts never break a paid response", async () => {
    const broken = { get: async () => { throw new Error("kv down"); }, put: async () => { throw new Error("kv down"); } } as unknown as KVNamespace;
    const store = makeReceiptStore(broken);
    await expect(store.record(entry("/r/x"))).resolves.toBeUndefined();
    expect(await store.list()).toEqual([]);
  });
});
