/**
 * src/routes/marketplace.ts — /marketplace, the human face of the catalog.
 *
 * The nav's "Catalog" link hands a person 1MB of JSON; agents want that, people
 * do not. This is the browsable twin: every wrapped route grouped by census
 * category, filterable by trust tier / method / price, and searchable
 * instantly.
 *
 * Search runs ENTIRELY in the browser over a compact index inlined in the page
 * (~68KB gzipped for all 2,349 routes). No query round-trips, no vector store:
 *
 *   - The census already classified every service into a category, so the
 *     semantic layer exists as a clean field — retrieval would re-derive it.
 *   - There is almost nothing to embed. Route descriptions are ~122 chars of
 *     identical boilerplate plus a ~60-char head, and 1,767 of 2,349 heads are
 *     just "METHOD /path on <site title>".
 *   - At this corpus size exact filtering is exhaustive and deterministic:
 *     a marketplace must never omit a listing that matches.
 *
 * The index is built once per isolate from the committed catalog.
 */

import { Hono } from "hono";
import type { AppEnv } from "../lib/appEnv";
import type { Config } from "../config";
import { catalog } from "../catalog";
import { usdString } from "../pricing";
import { routeLabel, endpointName, searchText } from "../lib/routeText";
import { SYNONYMS } from "../lib/routeMatch";
import { icon, type IconName } from "../lib/icons";

/* ── Category display names ───────────────────────────────────────────────
   Keys are the census taxonomy slugs carried on every route. An unknown slug
   falls back to a de-slugified label rather than being dropped. */
const CATEGORY_LABELS: Record<string, string> = {
  ai_inference: "AI inference",
  ai_agent_tool: "Agent tools",
  market_data: "Market data",
  data_oracle: "Data oracles",
  developer_tool: "Developer tools",
  token_analytics: "Token analytics",
  defi_analytics: "DeFi analytics",
  content_media: "Content & media",
  web_scraping: "Web scraping",
  web_search: "Web search",
  identity_kyc: "Identity & KYC",
  blockchain_rpc: "Blockchain RPC",
  other: "Other",
};

/** Category → Font Awesome glyph, so the browse grid reads at a glance. */
const CATEGORY_ICONS: Record<string, IconName> = {
  ai_inference: "brain",
  ai_agent_tool: "robot",
  market_data: "chart-line",
  data_oracle: "database",
  developer_tool: "code",
  token_analytics: "coins",
  defi_analytics: "chart-pie",
  content_media: "photo-film",
  web_scraping: "spider",
  web_search: "magnifying-glass",
  identity_kyc: "id-card",
  blockchain_rpc: "server",
  other: "shapes",
};

const categoryIcon = (slug: string): IconName => CATEGORY_ICONS[slug] ?? "shapes";

/**
 * Display-level bucket. The census distinguishes "unknown" (the classifier
 * abstained) from "other" (classified as neither), which matters upstream but
 * reads as two identical shrugs in a browse grid. Merged for BROWSING only —
 * /catalog still returns and filters on the real slug.
 */
function displayCategory(slug: string): string {
  return slug === "unknown" ? "other" : slug;
}

function categoryLabel(slug: string): string {
  return (
    CATEGORY_LABELS[slug] ??
    slug.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}

/** Tier ordering, best first — drives the "trust" sort and chip colours. */
const TIER_ORDER = ["Corroborated", "Established", "Emerging", "Listed", "Unrated"];

/* ── Index construction ───────────────────────────────────────────────── */

interface MarketIndex {
  /** service domains */ s: string[];
  /** category slugs */ c: string[];
  /** category display labels, parallel to c */ cl: string[];
  /** tier names */ t: string[];
  /** deduped route labels */ l: string[];
  /** deduped extra search-only text (census wording the origin summary drops) */
  x: string[];
  /** rows: [slug, serviceIdx, catIdx, tierIdx, isPost, priceMicroUsd, labelIdx, altIdx|-1] */
  r: [string, number, number, number, number, number, number, number][];
}

function buildIndex(): MarketIndex {
  const services: string[] = [];
  const cats: string[] = [];
  const tiers: string[] = [];
  const labels: string[] = [];
  const alts: string[] = [];
  const si = new Map<string, number>();
  const ci = new Map<string, number>();
  const ti = new Map<string, number>();
  const li = new Map<string, number>();
  const xi = new Map<string, number>();
  const intern = (v: string, arr: string[], m: Map<string, number>): number => {
    const hit = m.get(v);
    if (hit !== undefined) return hit;
    const i = arr.push(v) - 1;
    m.set(v, i);
    return i;
  };

  // A label that repeats inside one service isn't a name, it's the site title —
  // those routes get their endpoint path as the display name instead.
  const seen = new Map<string, number>();
  const rawLabels = catalog.routes.map((r) => routeLabel(r.description ?? "", r.slug));
  catalog.routes.forEach((r, i) => {
    const k = r.service + "\u0000" + rawLabels[i];
    seen.set(k, (seen.get(k) ?? 0) + 1);
  });

  const rows = catalog.routes.map((r, i) => {
    const raw = rawLabels[i]!;
    const label =
      (seen.get(r.service + "\u0000" + raw) ?? 0) > 1 ? endpointName(r.slug, r.service) : raw;
    const extra = searchText(r.description ?? "", r.slug);
    const alt = extra.toLowerCase() === label.toLowerCase() ? null : extra;
    return [
      r.slug,
      intern(r.service, services, si),
      intern(displayCategory(r.category || "other"), cats, ci),
      intern(r.tier || "Unrated", tiers, ti),
      r.method === "POST" ? 1 : 0,
      // micro-USD keeps the payload integral; the client divides by 1e6.
      Math.round(r.roamPriceUsd * 1e6),
      intern(label, labels, li),
      // Search-only: census wording the origin's summary phrases differently,
      // so switching the label to the origin cannot cost us a match.
      alt ? intern(alt, alts, xi) : -1,
    ] as MarketIndex["r"][number];
  });

  return { s: services, c: cats, cl: cats.map(categoryLabel), t: tiers, l: labels, x: alts, r: rows };
}

/** Built once per isolate — the catalog is a static import. */
const INDEX = buildIndex();

/** Route + service counts per category, for the browse tiles. */
function categoryStats(): { slug: string; label: string; routes: number; services: number }[] {
  const routes = new Map<string, number>();
  const svc = new Map<string, Set<string>>();
  for (const r of catalog.routes) {
    const k = displayCategory(r.category || "other");
    routes.set(k, (routes.get(k) ?? 0) + 1);
    (svc.get(k) ?? svc.set(k, new Set()).get(k)!).add(r.service);
  }
  return [...routes.entries()]
    .map(([slug, n]) => ({
      slug,
      label: categoryLabel(slug),
      routes: n,
      services: svc.get(slug)?.size ?? 0,
    }))
    .sort((a, b) => b.routes - a.routes);
}

/* ── Icons (inline, matching the landing set) ─────────────────────────── */

const ICON_SEARCH = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
const ICON_MENU = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`;

const BTN = `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium hover:-translate-y-0.5 transition-all duration-300`;

/* ── Page ─────────────────────────────────────────────────────────────── */

function page(cfg: Config): string {
  const base = cfg.publicBaseUrl || "";
  const routes = catalog.routes.length;
  const services = new Set(catalog.routes.map((r) => r.service)).size;
  const stats = categoryStats();
  const prices = catalog.routes.map((r) => r.roamPriceUsd).sort((a, b) => a - b);
  const floor = usdString(prices[0] ?? 0);
  const median = usdString(prices[Math.floor(prices.length / 2)] ?? 0);
  const title = "Marketplace | Roam402";
  const desc = `Browse ${routes} verified x402 routes from ${services} services across ${stats.length} categories — search by capability, filter by trust tier and price, pay in USDC on Algorand.`;

  const tiles = stats
    .map(
      (c) => `<button class="rx-mk-tile" data-cat="${c.slug}" type="button">
        <span class="rx-mk-tile-i">${icon(categoryIcon(c.slug), 18)}</span>
        <span class="rx-mk-tile-n">${c.routes}</span>
        <span class="rx-mk-tile-l">${c.label}</span>
        <span class="rx-mk-tile-s">${c.services} service${c.services === 1 ? "" : "s"}</span>
      </button>`
    )
    .join("\n        ");

  const catChips = [`<button class="rx-chip on" data-cat="" type="button">All</button>`]
    .concat(
      stats.map(
        (c) =>
          `<button class="rx-chip" data-cat="${c.slug}" type="button">${icon(categoryIcon(c.slug), 12)} ${c.label} <i>${c.routes}</i></button>`
      )
    )
    .join("\n          ");

  const tierChips = [`<button class="rx-chip on" data-tier="" type="button">Any tier</button>`]
    .concat(
      TIER_ORDER.filter((t) => INDEX.t.includes(t)).map(
        (t) => `<button class="rx-chip" data-tier="${t}" type="button">${t}</button>`
      )
    )
    .join("\n          ");

  // Inlined as JSON — escape "<" so the payload can never close the script tag.
  const indexJson = JSON.stringify(INDEX).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<meta name="description" content="${desc}"/>
<meta name="robots" content="index, follow"/>
<meta name="theme-color" content="#f4f5fb"/>
<meta property="og:title" content="${title}"/>
<meta property="og:description" content="${desc}"/>
<meta property="og:site_name" content="Roam402"/>
<meta property="og:type" content="website"/>
${base ? `<meta property="og:url" content="${base}/marketplace"/>` : ""}
<meta property="og:image" content="${base}/icons/banner.png"/>
<meta name="twitter:card" content="summary_large_image"/>
${base ? `<link rel="canonical" href="${base}/marketplace"/>` : ""}
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<link rel="icon" href="/favicon.ico" sizes="32x32"/>
<link rel="apple-touch-icon" href="/icons/icon.png"/>
<link rel="preload" href="/fonts/12084922609e6532-s.p.woff2" as="font" type="font/woff2" crossorigin/>
<link rel="preload" href="/fonts/22539d17f3707926-s.p.woff2" as="font" type="font/woff2" crossorigin/>
<link rel="stylesheet" href="/css/landing.css"/>
</head>
<body class="min-h-screen bg-background text-foreground antialiased font-heading overflow-x-hidden __variable_f367f3 __variable_b44e54 __variable_315a98">

<header class="sticky top-0 w-full h-16 bg-background/80 backdrop-blur-sm z-50">
  <div class="w-full mx-auto lg:max-w-screen-xl lg:mx-auto px-4 md:px-12 h-full">
    <div class="flex items-center justify-between h-full">
      <div class="flex items-center">
        <a class="flex items-center gap-2" href="/">
          <img src="/icons/roam402.svg" alt="Roam402" width="26" height="26"/>
          <span class="text-xl font-semibold">roam<span class="rx-accent">402</span></span>
        </a>
      </div>
      <div class="hidden lg:flex items-center gap-4">
        <ul class="flex items-center gap-8">
          <li class="text-sm font-medium link"><a href="/#how">How it works</a></li>
          <li class="text-sm font-medium link"><a class="rx-accent" href="/marketplace">Marketplace</a></li>
          <li class="text-sm font-medium link"><a href="/receipts">Receipts</a></li>
          <li class="text-sm font-medium link"><a href="/llms.txt">Agent spec</a></li>
        </ul>
      </div>
      <div class="flex items-center gap-4">
        <a class="hidden lg:block" href="/playground">
          <button class="${BTN} bg-primary text-primary-foreground hover:opacity-70 hover:ring-4 hover:ring-primary/10 h-9 px-4 py-2">Open playground</button>
        </a>
        <button id="menu-btn" aria-label="Menu" aria-expanded="false" class="${BTN} hover:bg-white/10 hover:text-accent-foreground h-8 w-8 lg:hidden" type="button">${ICON_MENU}</button>
      </div>
    </div>
  </div>
</header>
<div id="m-menu" class="rx-menu lg:hidden">
  <a href="/#how">How it works</a>
  <a href="/marketplace">Marketplace</a>
  <a href="/playground">Playground</a>
  <a href="/receipts">Receipts</a>
  <a href="/llms.txt">Agent spec</a>
</div>

<main class="mx-auto w-full z-40 relative">
  <div class="w-full mx-auto lg:max-w-screen-xl lg:mx-auto px-4 md:px-12 pt-12 pb-20 relative">

    <div class="rx-eyebrow">MARKETPLACE</div>
    <h1 class="text-3xl md:text-5xl font-bold !leading-tight mt-2">Every verified x402 service,<br/><span class="rx-grad">one USDC rail.</span></h1>
    <p class="text-base text-muted-foreground mt-3 max-w-2xl">${routes} wrapped routes from ${services} services across ${stats.length} categories — ${median} median a call, from ${floor}. Pay in USDC on Algorand; the origin is settled on its own chain and you get receipts from both.</p>

    <div class="rx-mk-search">
      <span class="rx-mk-search-i" aria-hidden="true">${icon("magnifying-glass", 15)}</span>
      <input id="q" type="search" autocomplete="off" spellcheck="false"
             placeholder="Search ${routes} routes — try &quot;speech&quot;, &quot;honeypot&quot;, &quot;chat completions&quot;, a service domain…"
             aria-label="Search the marketplace"/>
      <button id="clear" type="button" aria-label="Clear search" hidden>${icon("xmark", 13)}</button>
    </div>

    <!-- Category browse: shown until a filter or query narrows things down -->
    <section id="browse">
      <h2 class="rx-mk-h2">Browse by category</h2>
      <div class="rx-mk-tiles">
        ${tiles}
      </div>
    </section>

    <section class="rx-mk-filters">
      <div class="rx-mk-frow" id="cats" role="group" aria-label="Filter by category">
        ${catChips}
      </div>
      <div class="rx-mk-frow">
        <div class="flex flex-wrap gap-2" id="tiers" role="group" aria-label="Filter by trust tier">
          ${tierChips}
        </div>
        <div class="rx-mk-spacer"></div>
        <div class="flex flex-wrap items-center gap-2" id="methods" role="group" aria-label="Filter by method">
          <button class="rx-chip on" data-m="" type="button">GET + POST</button>
          <button class="rx-chip" data-m="GET" type="button">GET</button>
          <button class="rx-chip" data-m="POST" type="button">POST</button>
        </div>
        <label class="rx-mk-sort">Sort
          <select id="sort">
            <option value="trust">Trust tier</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
            <option value="service">Service A→Z</option>
          </select>
        </label>
      </div>
    </section>

    <div class="rx-mk-count" id="count" aria-live="polite"></div>
    <div class="rx-mk-grid" id="grid"></div>
    <div class="rx-mk-more"><button id="more" class="${BTN} border border-input hover:bg-white/10 h-10 px-8" type="button" hidden>Show more</button></div>
    <p class="rx-mk-foot">Machine-readable twin of this page: <a class="rx-accent rx-mono" href="/catalog">GET /catalog</a> — free, no key. Agents can also pay <a class="rx-accent rx-mono" href="/playground">/discover</a> for the same index as an x402 resource.</p>

  </div>
</main>

<footer class="footer flex flex-col relative items-center justify-center border-t border-foreground/5 pb-8 px-6 lg:px-8 w-full max-w-6xl mx-auto lg:pt-12 pt-8 gap-4">
  <div class="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-muted-foreground">
    <a class="link" href="/marketplace">Marketplace</a>
    <a class="link" href="/catalog">Catalog JSON</a>
    <a class="link" href="/playground">Playground</a>
    <a class="link" href="/receipts">Receipts</a>
    <a class="link" href="/llms.txt">llms.txt</a>
  </div>
  <p class="text-sm text-muted-foreground md:mt-0 text-center">© 2026 Roam402 · built by <a class="rx-accent" href="https://agents-trust.ai">Agents-Trust</a></p>
  <p class="text-[11px] text-muted-foreground/70 text-center">Icons by <a class="link" href="https://fontawesome.com/license/free" target="_blank" rel="noopener noreferrer">Font Awesome Free</a> (CC BY 4.0)</p>
</footer>

<script id="mk-index" type="application/json">${indexJson}</script>
<script>
(function () {
  var IX = JSON.parse(document.getElementById("mk-index").textContent);
  var $ = function (id) { return document.getElementById(id); };
  var TIER_RANK = ${JSON.stringify(TIER_ORDER)};
  var SYN = ${JSON.stringify(SYNONYMS)};
  var CAT_ICON = ${JSON.stringify(
    Object.fromEntries(stats.map((c) => [c.slug, icon(categoryIcon(c.slug), 11)]))
  )};
  var I_SHIELD = ${JSON.stringify(icon("shield-halved", 11))};
  var I_TAG = ${JSON.stringify(icon("tag", 11))};
  var I_ARROW = ${JSON.stringify(icon("arrow-right", 11))};
  var PAGE = 48;

  /* Flatten once: every row gets a lowercase haystack so keystroke filtering
     is a plain substring scan over 2.3k short strings (sub-millisecond). */
  var ROWS = IX.r.map(function (r) {
    var service = IX.s[r[1]], cat = IX.c[r[2]], catLabel = IX.cl[r[2]];
    var tier = IX.t[r[3]], label = IX.l[r[6]];
    return {
      slug: r[0], service: service, cat: cat, catLabel: catLabel, tier: tier,
      method: r[4] ? "POST" : "GET", price: r[5] / 1e6, label: label,
      hay: (label + " " + service + " " + r[0] + " " + catLabel +
            (r[7] >= 0 ? " " + IX.x[r[7]] : "")).toLowerCase(),
      rank: TIER_RANK.indexOf(tier) < 0 ? 99 : TIER_RANK.indexOf(tier)
    };
  });

  var state = { q: "", cat: "", tier: "", m: "", sort: "trust", shown: PAGE };

  function money(v) {
    if (v >= 0.01) return "$" + v.toFixed(2).replace(/0$/, "");
    var s = v.toFixed(6).replace(/0+$/, "").replace(/\\.$/, "");
    return "$" + s;
  }

  /* Word-START match: the needle must begin a word, but may end mid-word so
     stems still work ("transcri" finds transcription). Without the boundary,
     the "voice" alias matches every inVOICE route. */
  function hasWord(hay, w) {
    for (var i = hay.indexOf(w); i >= 0; i = hay.indexOf(w, i + 1)) {
      var before = i === 0 ? " " : hay.charAt(i - 1);
      if (before < "0" || (before > "9" && before < "a") || before > "z") return true;
    }
    return false;
  }

  /* A term matches literally (loose substring — what the caller typed wins),
     via a curated alias, or via a naive singular. Alias and singular hits are
     boundary-checked and tracked separately so they sort after exact ones. */
  function termHit(hay, term) {
    if (hay.indexOf(term) >= 0) return 2;
    var alts = SYN[term];
    if (alts) for (var i = 0; i < alts.length; i++) if (hasWord(hay, alts[i])) return 1;
    if (term.length > 3 && term.charAt(term.length - 1) === "s" &&
        hasWord(hay, term.slice(0, -1))) return 1;
    return 0;
  }

  /* Returns 0 = no match, else 1 + number of soft (alias) hits, so callers can
     both filter and rank in one pass. */
  function score(row, terms) {
    if (state.cat && row.cat !== state.cat) return 0;
    if (state.tier && row.tier !== state.tier) return 0;
    if (state.m && row.method !== state.m) return 0;
    var soft = 0;
    for (var i = 0; i < terms.length; i++) {
      var h = termHit(row.hay, terms[i]);
      if (!h) return 0;
      if (h === 1) soft++;
    }
    return 1 + soft;
  }

  function sorted(list) {
    var by = state.sort;
    return list.sort(function (a, b) {
      // Exact-word matches always outrank alias-widened ones.
      if (a.soft !== b.soft) return a.soft - b.soft;
      if (by === "price-asc") return a.price - b.price || a.rank - b.rank;
      if (by === "price-desc") return b.price - a.price || a.rank - b.rank;
      if (by === "service") return a.service.localeCompare(b.service) || a.slug.localeCompare(b.slug);
      return a.rank - b.rank || a.price - b.price;
    });
  }

  function card(r) {
    var el = document.createElement("article");
    el.className = "rx-mk-card";
    var tierCls = "rx-tier-" + r.tier.toLowerCase();
    el.innerHTML =
      '<div class="rx-mk-top">' +
        '<button class="rx-mk-cat" data-cat="' + r.cat + '" type="button">' + (CAT_ICON[r.cat] || "") + ' ' + r.catLabel + '</button>' +
        '<span class="rx-mk-tier ' + tierCls + '">' + I_SHIELD + ' ' + r.tier + '</span>' +
      '</div>' +
      '<h3 class="rx-mk-name"></h3>' +
      '<div class="rx-mk-svc rx-mono"></div>' +
      '<div class="rx-mk-path rx-mono"><span class="rx-mk-m">' + r.method + '</span> /r/' + r.slug + '</div>' +
      '<div class="rx-mk-bot">' +
        '<span class="rx-mk-price rx-mono">' + I_TAG + ' ' + money(r.price) + '</span>' +
        '<a class="rx-mk-try" href="/playground?route=' + encodeURIComponent(r.slug) + '">Try it ' + I_ARROW + '</a>' +
      '</div>';
    // textContent for anything origin-authored — never innerHTML.
    el.querySelector(".rx-mk-name").textContent = r.label;
    el.querySelector(".rx-mk-svc").textContent = r.service;
    return el;
  }

  function render() {
    var terms = state.q.toLowerCase().split(/[^a-z0-9.+-]+/).filter(Boolean);
    var hits = [];
    for (var i = 0; i < ROWS.length; i++) {
      var s = score(ROWS[i], terms);
      if (s) { ROWS[i].soft = s - 1; hits.push(ROWS[i]); }
    }
    hits = sorted(hits);
    var widened = 0;
    for (var k = 0; k < hits.length; k++) if (hits[k].soft) widened++;
    var grid = $("grid");
    grid.textContent = "";
    var slice = hits.slice(0, state.shown);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < slice.length; i++) frag.appendChild(card(slice[i]));
    grid.appendChild(frag);

    $("count").textContent = hits.length
      ? "Showing " + slice.length + " of " + hits.length + " route" + (hits.length === 1 ? "" : "s") +
        (widened ? " · " + widened + " matched on a related term" : "")
      : "";
    if (!hits.length) {
      var none = document.createElement("p");
      none.className = "rx-mk-empty";
      none.textContent = "No route matches those filters. Try a broader term, or clear the category filter.";
      grid.appendChild(none);
    }
    $("more").hidden = slice.length >= hits.length;
    $("clear").hidden = !state.q;
    // The browse tiles are the zero-state; hide them once anything is narrowed.
    $("browse").hidden = !!(state.q || state.cat || state.tier || state.m);
    syncUrl();
  }

  function syncUrl() {
    var p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.cat) p.set("cat", state.cat);
    if (state.tier) p.set("tier", state.tier);
    if (state.m) p.set("m", state.m);
    if (state.sort !== "trust") p.set("sort", state.sort);
    var qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  }

  function setActive(container, attr, value) {
    var btns = container.querySelectorAll("[" + attr + "]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("on", (btns[i].getAttribute(attr) || "") === value);
    }
  }

  function pickCat(v) {
    state.cat = v; state.shown = PAGE;
    setActive($("cats"), "data-cat", v);
    render();
  }

  /* wiring */
  var t = null;
  $("q").addEventListener("input", function () {
    clearTimeout(t);
    t = setTimeout(function () { state.q = $("q").value.trim(); state.shown = PAGE; render(); }, 90);
  });
  $("clear").addEventListener("click", function () {
    $("q").value = ""; state.q = ""; state.shown = PAGE; render(); $("q").focus();
  });
  $("cats").addEventListener("click", function (e) {
    var b = e.target.closest("[data-cat]"); if (b) pickCat(b.getAttribute("data-cat") || "");
  });
  $("browse").addEventListener("click", function (e) {
    var b = e.target.closest("[data-cat]");
    if (b) { pickCat(b.getAttribute("data-cat") || ""); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });
  $("grid").addEventListener("click", function (e) {
    var b = e.target.closest(".rx-mk-cat");
    if (b) { pickCat(b.getAttribute("data-cat") || ""); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });
  $("tiers").addEventListener("click", function (e) {
    var b = e.target.closest("[data-tier]"); if (!b) return;
    state.tier = b.getAttribute("data-tier") || ""; state.shown = PAGE;
    setActive($("tiers"), "data-tier", state.tier); render();
  });
  $("methods").addEventListener("click", function (e) {
    var b = e.target.closest("[data-m]"); if (!b) return;
    state.m = b.getAttribute("data-m") || ""; state.shown = PAGE;
    setActive($("methods"), "data-m", state.m); render();
  });
  $("sort").addEventListener("change", function () { state.sort = $("sort").value; render(); });
  $("more").addEventListener("click", function () { state.shown += PAGE; render(); });

  /* deep link: /marketplace?cat=ai_inference&q=speech */
  (function boot() {
    var p = new URLSearchParams(location.search);
    state.q = p.get("q") || "";
    state.cat = p.get("cat") === "unknown" ? "other" : p.get("cat") || "";
    state.tier = p.get("tier") || "";
    state.m = p.get("m") || "";
    state.sort = p.get("sort") || "trust";
    $("q").value = state.q;
    $("sort").value = state.sort;
    setActive($("cats"), "data-cat", state.cat);
    setActive($("tiers"), "data-tier", state.tier);
    setActive($("methods"), "data-m", state.m);
    render();
  })();

  var btn = $("menu-btn"), menu = $("m-menu");
  if (btn && menu) {
    btn.addEventListener("click", function () {
      btn.setAttribute("aria-expanded", menu.classList.toggle("open") ? "true" : "false");
    });
  }
})();
</script>
</body>
</html>`;
}

export function mountMarketplace(app: Hono<AppEnv>, cfg: Config): void {
  app.get("/marketplace", (c) =>
    c.html(page(cfg), 200, { "cache-control": "public, max-age=300" })
  );
}
