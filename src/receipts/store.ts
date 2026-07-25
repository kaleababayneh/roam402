/**
 * src/receipts/store.ts — the public proof-of-payers log.
 *
 * Every successful paid call is recorded (no buyer PII — route, service,
 * price, origin receipt reference, timestamp) into Workers KV when the
 * RECEIPTS binding exists; without the binding the store degrades to a
 * no-op so local dev and pre-KV deploys keep working.
 *
 * Why it exists: the challenge submission asks for "proof of who is
 * paying" — /receipts answers it continuously and in public, which is
 * also the Agents-Trust way.
 */

export interface ReceiptEntry {
  ts: string;
  route: string;
  service: string;
  method: string;
  priceUsd: number;
  /** Origin-chain x402 settlement reference (truncated, verifiable). */
  originReceipt: string | null;
  originChain: string | null;
}

const INDEX_KEY = "receipts:index";
const MAX_KEPT = 200;

export interface ReceiptStore {
  record(entry: ReceiptEntry): Promise<void>;
  list(): Promise<ReceiptEntry[]>;
  enabled: boolean;
}

/** KV-backed store; `kv === undefined` → inert store (never throws). */
export function makeReceiptStore(kv: KVNamespace | undefined): ReceiptStore {
  if (!kv) {
    return {
      enabled: false,
      record: async () => {},
      list: async () => [],
    };
  }
  return {
    enabled: true,
    async record(entry: ReceiptEntry): Promise<void> {
      try {
        const raw = await kv.get(INDEX_KEY);
        const entries = raw ? (JSON.parse(raw) as ReceiptEntry[]) : [];
        entries.unshift(entry);
        await kv.put(INDEX_KEY, JSON.stringify(entries.slice(0, MAX_KEPT)));
      } catch {
        // Receipts are best-effort — never fail a paid response over logging.
      }
    },
    async list(): Promise<ReceiptEntry[]> {
      try {
        const raw = await kv.get(INDEX_KEY);
        return raw ? (JSON.parse(raw) as ReceiptEntry[]) : [];
      } catch {
        return [];
      }
    },
  };
}
