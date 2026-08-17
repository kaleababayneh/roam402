/**
 * src/lib/routeMatch.ts — how a natural-language query becomes a route match.
 *
 * One matcher, two callers: the marketplace page (client-side, over its inlined
 * index) and /resolve (server-side, over the catalog). The SYNONYM DATA is the
 * part that rots when the catalog is regenerated, so it lives here as the
 * single source of truth and is held to the catalog by tests.
 */

/**
 * Query aliases — the cheap fix for vocabulary mismatch.
 *
 * Route text is short and literal, so a caller who types the word the industry
 * uses ("tts", "honeypot", "ohlc") misses listings that describe the same
 * capability differently. Every entry below was chosen by measuring both sides
 * against the live catalog: the key is a term that finds almost nothing on its
 * own, and the expansions are terms that actually occur in route text.
 * Measured 2026-08-16, e.g. tts=2 → speech=6 / voice=13 / audio=10,
 * llm=14 → chat=40 / model=31 / prompt=20, honeypot=1 → audit=21 / risk=77.
 *
 * Alias hits rank BELOW literal hits, so widening never buries an exact match.
 */
export const SYNONYMS: Record<string, string[]> = {
  // speech / audio
  tts: ["speech", "voice", "audio"],
  stt: ["transcri", "speech", "audio"],
  voice: ["speech", "audio", "tts"],
  speech: ["voice", "audio", "transcri"],
  transcribe: ["transcri", "speech", "audio"],
  transcription: ["transcri", "speech", "audio"],
  // language models
  llm: ["chat", "completion", "inference", "model", "prompt"],
  gpt: ["chat", "completion", "model", "prompt"],
  claude: ["chat", "completion", "model", "anthropic"],
  chatbot: ["chat", "completion", "agent"],
  embedding: ["embed", "vector"],
  embeddings: ["embed", "vector"],
  summarize: ["summar"],
  summarise: ["summar"],
  translate: ["translat", "language"],
  // Token safety. Deliberately WITHOUT the bare "risk" (77 hits): it drags in
  // macro-regime and lending-LTV routes that have nothing to do with a token
  // rug check. "safety" is a broad query already, so it keeps risk.
  honeypot: ["rug", "scam", "audit", "security"],
  rugpull: ["rug", "scam", "audit", "honeypot"],
  rug: ["scam", "audit", "honeypot", "security"],
  scam: ["rug", "audit", "security", "honeypot"],
  safety: ["risk", "audit", "security", "scam"],
  // market data
  ohlc: ["candle", "price", "market", "ticker"],
  candles: ["candle", "ohlc", "price", "market"],
  candlestick: ["candle", "ohlc", "price"],
  chart: ["candle", "price", "market"],
  quotes: ["quote", "price", "ticker"],
  whale: ["holder", "wallet", "address"],
  whales: ["holder", "wallet", "address"],
  // vision / documents
  ocr: ["image", "extract", "vision", "text"],
  vision: ["image", "ocr"],
  // identity / infra
  kyc: ["identity", "compliance", "verification", "sanction"],
  aml: ["compliance", "sanction", "risk", "identity"],
  rpc: ["node", "chain", "blockchain"],
  whois: ["domain", "dns"],
  // web
  crawl: ["scrape", "extract", "web"],
  crawler: ["scrape", "extract", "web"],
  scraper: ["scrape", "extract", "web"],
  // defi
  nft: ["token", "collection", "mint"],
  dex: ["swap", "liquidity", "pool", "trade"],
  swap: ["dex", "liquidity", "pool", "trade"],
  apy: ["yield", "stake"],
  // social
  sentiment: ["social", "news", "twitter"],
  tweet: ["twitter", "social"],
  tweets: ["twitter", "social"],
};

/** Words that carry no routing signal in a request like "I want to …". */
const STOPWORDS = new Set([
  "a","an","and","any","are","as","at","be","best","by","can","cheap","cheapest","do","does",
  "find","for","from","get","give","have","how","i","in","is","it","me","my","need","of","on",
  "or","please","route","service","that","the","then","there","to","use","want","what","which",
  "with","would","you","api","endpoint",
]);

/** Query → the terms worth matching on. */
export function termsOf(intent: string): string[] {
  return [
    ...new Set(
      intent
        .toLowerCase()
        .split(/[^a-z0-9.+-]+/)
        .map((t) => t.replace(/^[.+-]+|[.+-]+$/g, ""))
        .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    ),
  ].slice(0, 12);
}

/**
 * Word-START match: the needle must begin a word but may end mid-word, so stems
 * still reach forward ("transcri" finds transcription) while the "voice" alias
 * stays out of "invoice".
 */
export function hasWord(hay: string, w: string): boolean {
  for (let i = hay.indexOf(w); i >= 0; i = hay.indexOf(w, i + 1)) {
    const before = i === 0 ? " " : hay.charAt(i - 1);
    if (!/[a-z0-9]/.test(before)) return true;
  }
  return false;
}

/** 2 = the caller's own word, 1 = a curated alias or singular, 0 = no match. */
export function termHit(hay: string, term: string): 0 | 1 | 2 {
  if (hay.indexOf(term) >= 0) return 2;
  const alts = SYNONYMS[term];
  if (alts) for (const a of alts) if (hasWord(hay, a)) return 1;
  if (term.length > 3 && term.endsWith("s") && hasWord(hay, term.slice(0, -1))) return 1;
  return 0;
}

/** Trust ordering, best first — a small tiebreak, never a relevance override. */
export const TIER_RANK: Record<string, number> = {
  Corroborated: 0,
  Established: 1,
  Emerging: 2,
  Listed: 3,
  Unrated: 4,
};

export interface Matchable {
  /** Lowercased text to match against (see routeText.searchText). */
  hay: string;
  tier: string;
  priceUsd: number;
}

export interface MatchScore {
  /** Relevance only. 0 means the route did not match every term. */
  score: number;
  /** Terms the caller actually typed that hit literally. */
  exact: string[];
  /** Terms that only matched through an alias. */
  viaAlias: string[];
}

/**
 * Relevance for one route against one query.
 *
 * Requiring EVERY term is too strict for prose ("I need to check a token for
 * honeypots before buying"), so this scores partial coverage and lets ranking
 * sort it out — but a route matching no term at all scores 0 and is dropped.
 * Literal hits are worth double an alias hit, and trust/price only break ties:
 * a Corroborated route must never outrank a genuinely better match.
 */
export function scoreMatch(row: Matchable, terms: string[]): MatchScore {
  const exact: string[] = [];
  const viaAlias: string[] = [];
  for (const t of terms) {
    const h = termHit(row.hay, t);
    if (h === 2) exact.push(t);
    else if (h === 1) viaAlias.push(t);
  }
  if (!exact.length && !viaAlias.length) return { score: 0, exact, viaAlias };

  const coverage = (exact.length * 2 + viaAlias.length) / (terms.length * 2 || 1);
  const trust = (4 - (TIER_RANK[row.tier] ?? 4)) / 4; // 0..1
  // Cheaper is a mild plus; log-scaled so a $0.000001 route cannot win on price.
  const cheap = 1 / (1 + Math.log10(1 + row.priceUsd * 1_000_000));
  return { score: coverage * 0.8 + trust * 0.15 + cheap * 0.05, exact, viaAlias };
}
