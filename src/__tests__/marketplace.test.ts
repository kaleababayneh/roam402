import { describe, it, expect } from "vitest";
import { SYNONYMS, endpointName, routeLabel } from "../routes/marketplace";
import { catalog } from "../catalog";

/**
 * The synonym map is hand-curated data, so it rots silently: a catalog
 * regeneration can retire the very vocabulary an alias points at, leaving a
 * query that still finds nothing. These tests hold it to the catalog.
 */

/** Same field set the client search builds its haystack from. */
const haystacks = catalog.routes.map((r) =>
  [
    routeLabel(r.description ?? "", r.slug),
    r.service,
    r.slug.replace(/-/g, " "),
  ]
    .join(" ")
    .toLowerCase()
);

/** Word-START match — mirrors hasWord() in the page script. */
function hasWord(hay: string, w: string): boolean {
  for (let i = hay.indexOf(w); i >= 0; i = hay.indexOf(w, i + 1)) {
    const before = i === 0 ? " " : hay.charAt(i - 1);
    if (!/[a-z0-9]/.test(before)) return true;
  }
  return false;
}

const countWord = (w: string): number => haystacks.filter((h) => hasWord(h, w)).length;

describe("marketplace synonyms", () => {
  it("keys are bare lowercase single tokens", () => {
    for (const key of Object.keys(SYNONYMS)) {
      expect(key, key).toBe(key.toLowerCase().trim());
      expect(key, key).not.toMatch(/\s/);
    }
  });

  it("no alias expands to itself and none is empty", () => {
    for (const [key, alts] of Object.entries(SYNONYMS)) {
      expect(alts.length, key).toBeGreaterThan(0);
      expect(alts, key).not.toContain(key);
      expect(new Set(alts).size, key).toBe(alts.length);
    }
  });

  it("every expansion term actually occurs in the catalog", () => {
    // An alias pointing at vocabulary no route uses is dead weight — it widens
    // nothing. If this fails after a catalog regen, retire or repoint the term.
    const dead: string[] = [];
    for (const [key, alts] of Object.entries(SYNONYMS)) {
      for (const alt of alts) if (countWord(alt) === 0) dead.push(`${key} → ${alt}`);
    }
    expect(dead).toEqual([]);
  });

  it("aliases widen the queries they exist for", () => {
    // Each key is meant to be a term that under-performs on its own.
    for (const [key, alts] of Object.entries(SYNONYMS)) {
      const widened = Math.max(...alts.map(countWord));
      expect(widened, `${key} should reach more than it does alone`).toBeGreaterThan(0);
    }
  });

  it("word-boundary matching keeps 'voice' out of 'invoice'", () => {
    expect(hasWord("multi-currency financial invoice", "voice")).toBe(false);
    expect(hasWord("ai voice synthesis", "voice")).toBe(true);
    // stems still match forward: transcri → transcription
    expect(hasWord("transcription api", "transcri")).toBe(true);
    // hyphens are boundaries, so text-to-speech is reachable
    expect(hasWord("text-to-speech (elevenlabs)", "speech")).toBe(true);
  });
});

describe("marketplace naming", () => {
  it("routeLabel strips the shared boilerplate tail and the METHOD /path prefix", () => {
    const d =
      "GET /v1/tator/prompt on Quick Intel x402 Gateway · via Roam402 from quickintel.io (Listed on Agents-Trust) · pay USDC on Algorand.";
    expect(routeLabel(d, "quickintel-tator-prompt")).toBe("Quick Intel x402 Gateway");
  });

  it("routeLabel decodes entities and falls back to the slug when empty", () => {
    expect(routeLabel("Routing &amp; payment · via Roam402 from x", "s")).toBe(
      "Routing & payment"
    );
    expect(routeLabel("", "some-slug")).toBe("some-slug");
  });

  it("endpointName drops the service prefix so sibling routes differ", () => {
    expect(endpointName("emc2ai-bagcheck-raw", "emc2ai.io")).toBe("Bagcheck raw");
    expect(endpointName("ottoai-pm-crypto", "ottoai.services")).toBe("Pm crypto");
    // no shared prefix: keep the whole slug rather than mangling it
    expect(endpointName("standalone-route", "other.com")).toBe("Standalone route");
  });
});
