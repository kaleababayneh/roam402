/**
 * src/lib/log.ts — structured single-line logs (Workers tail-friendly).
 * Never log payment payloads, keys, or full origin responses.
 */

export function log(event: string, fields: Record<string, string | number | boolean | null | undefined> = {}): void {
  const clean = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined)
  );
  console.log(JSON.stringify({ event, ...clean, t: Date.now() }));
}
