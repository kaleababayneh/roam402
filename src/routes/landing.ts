/**
 * src/routes/landing.ts — the merchant's public face, served by the worker.
 *
 * Light Agents-Trust-skinned landing in the cronpay template structure
 * (compiled Tailwind sheet + template fonts served from /public via Workers
 * static assets). Deliberately concise: hero with the live census preview,
 * one merged how-it-works section (flow rail + terminal + capability row),
 * the live catalog tables, and a closing CTA. No decorative vignette
 * illustrations; real data and typography carry the page.
 *
 * The Bazaar enriches merchant pages from domain metadata, so meta tags and
 * copy are scoring surface, not vanity. Every dynamic value (route count,
 * catalog rows, native prices, network) renders from the same catalog the
 * 402s use.
 *
 * Also serves the agentic discovery files (/llms.txt,
 * /.well-known/agents.json) the challenge checklist rewards.
 */

import { Hono } from "hono";
import type { AppEnv } from "../lib/appEnv";
import type { Config } from "../config";
import { catalog } from "../catalog";
import { NATIVE_ROUTES } from "./native";
import { usdString } from "../pricing";

/* ── inline SVG marks (simple-icons paths; Base mark from base.org brand) ── */

const MARK_ALGORAND = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M13.874 0h3.673l1.61 5.963h3.789l-2.588 4.5 3.624 13.533h-3.757l-2.44-9.077-5.247 9.079H8.345l8.107-14.051-1.304-4.878L4.215 24H.018Z"/></svg>`;

const MARK_SOLANA = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="m23.8764 18.0313-3.962 4.1393a.9201.9201 0 0 1-.306.2106.9407.9407 0 0 1-.367.0742H.4599a.4689.4689 0 0 1-.2522-.0733.4513.4513 0 0 1-.1696-.1962.4375.4375 0 0 1-.0314-.2545.4438.4438 0 0 1 .117-.2298l3.9649-4.1393a.92.92 0 0 1 .3052-.2102.9407.9407 0 0 1 .3658-.0746H23.54a.4692.4692 0 0 1 .2523.0734.4531.4531 0 0 1 .1697.196.438.438 0 0 1 .0313.2547.4442.4442 0 0 1-.1169.2297zm-3.962-8.3355a.9202.9202 0 0 0-.306-.2106.941.941 0 0 0-.367-.0742H.4599a.4687.4687 0 0 0-.2522.0734.4513.4513 0 0 0-.1696.1961.4376.4376 0 0 0-.0314.2546.444.444 0 0 0 .117.2297l3.9649 4.1394a.9204.9204 0 0 0 .3052.2102c.1154.049.24.0744.3658.0746H23.54a.469.469 0 0 0 .2523-.0734.453.453 0 0 0 .1697-.1961.4382.4382 0 0 0 .0313-.2546.4444.4444 0 0 0-.1169-.2297zM.46 6.7225h18.7815a.9411.9411 0 0 0 .367-.0742.9202.9202 0 0 0 .306-.2106l3.962-4.1394a.4442.4442 0 0 0 .117-.2297.4378.4378 0 0 0-.0314-.2546.453.453 0 0 0-.1697-.196.469.469 0 0 0-.2523-.0734H4.7596a.941.941 0 0 0-.3658.0745.9203.9203 0 0 0-.3052.2102L.1246 5.9687a.4438.4438 0 0 0-.1169.2295.4375.4375 0 0 0 .0312.2544.4512.4512 0 0 0 .1692.196.4689.4689 0 0 0 .2518.0739z"/></svg>`;

const MARK_ETHEREUM = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M11.944 17.97 4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0 4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z"/></svg>`;

const MARK_BASE = `<svg viewBox="0 0 111 111" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M54.921 110.034C85.359 110.034 110.034 85.402 110.034 55.017C110.034 24.6319 85.359 0 54.921 0C26.0432 0 2.35281 22.1714 0 50.3923H72.8467V59.6416H0C2.35281 87.8625 26.0432 110.034 54.921 110.034Z"/></svg>`;

const ICON_USDC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10"/><path d="M16 8.6h-5.2a2.1 2.1 0 1 0 0 4.2h2.4a2.1 2.1 0 1 1 0 4.2H8"/><path d="M12 5.6v2.2m0 8.4v2.2"/></svg>`;

const ARROW_RIGHT = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4 group-hover:translate-x-1 transition-all duration-300"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;

/* buttons share the template's compiled utility recipe */
const BTN = `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium hover:-translate-y-0.5 transition-all duration-300`;

const TIER_CLASS: Record<string, string> = {
  Corroborated: "rx-tier-corroborated",
  Established: "rx-tier-established",
  Emerging: "rx-tier-emerging",
};

function tierChip(tier: string): string {
  const cls = TIER_CLASS[tier] ?? "rx-tier-listed";
  return `<span class="text-sm font-semibold ${cls}">${tier}</span>`;
}

function catalogPreviewRows(): string {
  return catalog.routes
    .slice(0, 6)
    .map(
      (r) => `<div class="grid rx-t-grid text-sm py-2 border-t border-border/50 items-center">
            <div class="rx-mono rx-trunc" style="font-size:12.5px">/r/${r.slug}</div>
            <div class="rx-trunc text-muted-foreground" style="font-size:12.5px">${r.service}</div>
            <div>${tierChip(r.tier)}</div>
            <div class="rx-mono rx-price" style="font-size:12.5px">${usdString(r.roamPriceUsd)}</div>
          </div>`
    )
    .join("\n          ");
}

function nativeRows(): string {
  return NATIVE_ROUTES.map((r) => {
    const name = r.path.slice(1).replace(/^./, (c) => c.toUpperCase());
    return `<div class="grid rx-t-grid text-sm py-2 border-t border-border/50 items-center">
            <div>${name}</div>
            <div class="rx-mono rx-trunc" style="font-size:12.5px">${r.path}</div>
            <div class="rx-mono rx-price" style="font-size:12.5px">${usdString(r.priceUsd)}</div>
            <div class="text-sm font-semibold text-green-500">live</div>
          </div>`;
  }).join("\n          ");
}

/* orbiting hero decoration: chains roaming around the Algorand-anchored gateway */
function orbitRings(): string {
  const dot = (cls: string) =>
    `<svg class="${cls}" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="10" fill="currentColor"/></svg>`;
  const orb = (radius: number, duration: number, angle: number, inner: string) =>
    `<div style="--duration:${duration};--radius:${radius};--angle:${angle};--icon-size:34px" class="absolute flex size-[var(--icon-size)] transform-gpu animate-orbit items-center justify-center rounded-full">${inner}</div>`;
  const ring = (r: number) =>
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" class="pointer-events-none absolute inset-0 size-full"><circle class="stroke-white/10 stroke-1 currentColor" stroke-dasharray="5 5" cx="50%" cy="50%" r="${r}" fill="none"/></svg>`;
  const mark = (svg: string, size: string, tone: string) =>
    `<span class="${size} ${tone}" aria-hidden="true">${svg}</span>`;

  return `${ring(300)}
        ${orb(300, 40, 0, mark(MARK_ALGORAND, "size-5", "text-foreground/80"))}
        ${orb(300, 40, 180, mark(ICON_USDC, "size-5", "text-foreground/60"))}
        ${ring(400)}
        ${orb(400, 80, 0, mark(MARK_BASE, "size-4", "text-foreground/70"))}
        ${orb(400, 80, 120, mark(MARK_SOLANA, "size-4", "text-foreground/70"))}
        ${orb(400, 80, 240, dot("size-1 text-foreground/50"))}
        ${ring(500)}
        ${orb(500, 200, 0, dot("size-1 text-foreground/50"))}
        ${orb(500, 200, 90, mark(MARK_ETHEREUM, "size-5", "text-foreground/60"))}
        ${orb(500, 200, 180, dot("size-1 text-foreground/90"))}
        ${orb(500, 200, 270, dot("size-1 text-foreground/50"))}`;
}

const LUCIDE = {
  shield: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-5 rx-accent"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>`,
  chart: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-5 rx-accent"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>`,
  wallet: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-5 rx-accent"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg>`,
  menu: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`,
  filter: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
  download: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`,
  trend: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`,
};

function page(cfg: Config): string {
  const n = catalog.routes.length;
  const services = new Set(catalog.routes.map((r) => r.service)).size;
  const base = cfg.publicBaseUrl || "";
  const gatewayHost = base || "https://roam402.com";
  const title = "Roam402 | Every x402 service, payable on Algorand";
  const desc = `Roam402 is the x402 roaming gateway for AI agents: ${n} verified services from the $45M+ x402 economy, payable in USDC on Algorand via the GoPlausible facilitator, fulfilled cross-chain with dual receipts. By Agents-Trust.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<meta name="description" content="${desc}"/>
<meta name="keywords" content="x402,Algorand,AI agents,agent payments,USDC,x402 gateway,x402 catalog,dual-chain receipts,machine payments,GoPlausible,Agents-Trust,MCP"/>
<meta name="author" content="Roam402"/>
<meta name="creator" content="Agents-Trust"/>
<meta name="robots" content="index, follow"/>
<meta name="format-detection" content="telephone=no, address=no, email=no"/>
<meta name="theme-color" content="#f4f5fb"/>
<meta property="og:title" content="${title}"/>
<meta property="og:description" content="${n} trust-tiered services · one Algorand merchant · dual-chain receipts. By Agents-Trust."/>
<meta property="og:site_name" content="Roam402"/>
<meta property="og:locale" content="en_US"/>
<meta property="og:type" content="website"/>
${base ? `<meta property="og:url" content="${base}/"/>` : ""}
<meta property="og:image" content="${base}/icons/banner.png"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:image:alt" content="Roam402, the x402 roaming gateway on Algorand"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${title}"/>
<meta name="twitter:description" content="The roaming gateway for AI agents: pay USDC on Algorand, call verified x402 services on Base, Solana, and Ethereum, get receipts from both chains."/>
<meta name="twitter:image" content="${base}/icons/banner.png"/>
${base ? `<link rel="canonical" href="${base}/"/>` : ""}
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<link rel="icon" href="/favicon.ico" sizes="32x32"/>
<link rel="apple-touch-icon" href="/icons/icon.png"/>
<link rel="preload" href="/fonts/12084922609e6532-s.p.woff2" as="font" type="font/woff2" crossorigin/>
<link rel="preload" href="/fonts/22539d17f3707926-s.p.woff2" as="font" type="font/woff2" crossorigin/>
<link rel="preload" href="/fonts/e4af272ccee01ff0-s.p.woff2" as="font" type="font/woff2" crossorigin/>
<link rel="preload" href="/fonts/e6099e249fd938cc-s.p.woff2" as="font" type="font/woff2" crossorigin/>
<link rel="stylesheet" href="/css/landing.css"/>
<noscript><style>.reveal{opacity:1;transform:none}</style></noscript>
</head>
<body class="min-h-screen bg-background text-foreground antialiased font-heading overflow-x-hidden __variable_f367f3 __variable_b44e54 __variable_315a98">

<!-- ── Header ─────────────────────────────────────────────────────────── -->
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
          <li class="text-sm font-medium link"><a href="/catalog">Catalog</a></li>
          <li class="text-sm font-medium link"><a href="/receipts">Receipts</a></li>
          <li class="text-sm font-medium link"><a href="/llms.txt">Agent spec</a></li>
        </ul>
      </div>
      <div class="flex items-center gap-4">
        <a class="hidden lg:block" href="/playground">
          <button class="${BTN} border border-input bg-blue-500 text-white hover:bg-blue-600 h-9 px-4 py-2">Open playground</button>
        </a>
        <button id="menu-btn" aria-label="Menu" aria-expanded="false" class="${BTN} hover:bg-white/10 hover:text-accent-foreground h-8 w-8 lg:hidden" type="button">${LUCIDE.menu}</button>
      </div>
    </div>
  </div>
</header>
<div id="m-menu" class="rx-menu lg:hidden">
  <a href="/#how">How it works</a>
  <a href="/catalog">Catalog</a>
  <a href="/playground">Playground</a>
  <a href="/receipts">Receipts</a>
  <a href="/llms.txt">Agent spec</a>
</div>

<main class="mx-auto w-full z-40 relative">
  <div class="w-full mx-auto lg:max-w-screen-xl lg:mx-auto px-4 md:px-12 py-20 relative">

    <!-- ── Hero ───────────────────────────────────────────────────────── -->
    <div class="relative flex flex-col items-center justify-center w-full py-20">
      <div class="absolute flex lg:hidden size-40 rounded-full bg-blue-500 blur-[10rem] top-0 left-1/2 -translate-x-1/2 -z-10"></div>
      <div class="flex flex-col items-center justify-center gap-y-8 relative">
        <div class="h-full hidden lg:flex absolute inset-0 top-0 mb-auto flex-col items-center justify-center w-full min-h-screen -z-10">
        ${orbitRings()}
        </div>

        <div class="flex flex-col items-center justify-center text-center gap-y-4 bg-background/0">
          <div class="w-full h-full relative overflow-hidden reveal">
            <span class="rx-pill mx-auto">
              <span class="rx-pill-inner">
                <span class="px-2 py-[0.5px] h-[18px] tracking-wide flex items-center justify-center rounded-full bg-gradient-to-r from-sky-400 to-blue-600 text-[9px] font-medium text-white">NEW</span>
                x402 roaming gateway · Algorand ${cfg.network}
              </span>
            </span>
          </div>

          <div class="w-full h-full reveal" style="--rd:.08s">
            <h1 class="text-4xl md:text-5xl lg:text-7xl font-bold text-center !leading-tight max-w-4xl mx-auto">Every x402 service,<br/><span class="rx-grad">payable on Algorand.</span></h1>
          </div>

          <div class="w-full h-full reveal" style="--rd:.16s">
            <p class="max-w-xl mx-auto mt-2 text-base lg:text-lg text-center text-muted-foreground">Roam402 is the roaming gateway for AI agents. Pay USDC on Algorand, call verified services that live on Base, Solana, and Ethereum, and get a cryptographic receipt from both chains with every response.</p>
          </div>

          <div class="w-full h-full z-20 reveal" style="--rd:.24s">
            <div class="flex items-center justify-center mt-6 gap-x-4">
              <a class="flex items-center gap-2 group" href="/catalog">
                <button class="${BTN} bg-primary text-primary-foreground hover:opacity-70 hover:ring-4 hover:ring-primary/10 h-10 px-8">Explore catalog${ARROW_RIGHT}</button>
              </a>
              <a class="flex items-center gap-2 group" href="/playground">
                <button class="${BTN} border border-input hover:bg-white/10 hover:text-accent-foreground h-10 px-8">Try playground</button>
              </a>
            </div>
            <div class="rx-statline">
              <span><b>${n}</b>wrapped routes</span>
              <span><b>${services}</b>verified services</span>
              <span><b class="rx-money">$45M+</b>settlement indexed</span>
              <span><b>2</b>chains per receipt</span>
            </div>
          </div>

          <!-- live census preview (real data, not a mock) -->
          <div class="w-full h-full relative reveal" style="--rd:.3s">
            <a href="https://agents-trust.com" aria-label="Open the Agents-Trust census">
              <div class="relative rounded-xl lg:rounded-[32px] border border-border p-2 backdrop-blur-lg mt-10 max-w-6xl mx-auto">
                <div class="absolute top-1/8 left-1/2 -z-10 bg-gradient-to-r from-sky-500 to-blue-600 w-1/2 lg:w-3/4 -translate-x-1/2 h-1/4 -translate-y-1/2 inset-0 blur-[4rem] lg:blur-[10rem] animate-image-glow"></div>
                <div class="hidden lg:block absolute -top-1/8 left-1/2 -z-20 bg-blue-600 w-1/4 -translate-x-1/2 h-1/4 -translate-y-1/2 inset-0 blur-[10rem] animate-image-glow"></div>
                <div class="rounded-lg lg:rounded-[22px] border border-border rx-inner">
                  <img alt="The live Agents-Trust census of x402 settlement that powers the Roam402 catalog" loading="lazy" width="1920" height="1080" decoding="async" class="rounded-lg lg:rounded-[20px]" style="color:transparent" src="/images/dashboard.png"/>
                </div>
              </div>
              <div class="bg-gradient-to-t from-background to-transparent absolute bottom-0 inset-x-0 w-full h-1/2"></div>
            </a>
            <p class="text-sm text-muted-foreground mt-4 text-center relative z-20">Live data: the <a class="rx-accent" href="https://agents-trust.com">Agents-Trust census</a> this catalog is built from</p>
          </div>
        </div>
      </div>
    </div>

    <!-- ── How it works ───────────────────────────────────────────────── -->
    <div id="how" class="relative flex flex-col items-center justify-center w-full py-20">
      <div class="w-full h-full reveal">
        <div class="flex flex-col items-center text-center max-w-2xl mx-auto mb-12">
          <h2 class="text-2xl md:text-4xl lg:text-5xl font-heading font-medium !leading-snug">How roaming <span class="font-subheading italic">works</span></h2>
          <p class="text-base md:text-lg text-accent-foreground/80 mt-4">Standard x402, no SDK required. Any client that speaks HTTP 402 can pay.</p>
        </div>
      </div>

      <div class="w-full max-w-6xl mx-auto rx-flow reveal">
        <div class="rx-flow-line" aria-hidden="true"></div>
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-10 lg:gap-6">
          <div class="rx-step">
            <div class="rx-node" aria-hidden="true"></div>
            <div class="rx-mono rx-accent" style="font-size:11px;letter-spacing:.08em">01 · HTTP 402</div>
            <h3 class="text-xl font-semibold mt-2">Call any route</h3>
            <p class="text-sm text-muted-foreground mt-2">GET or POST with no payment. The gateway answers with the exact x402 challenge: USDC price, merchant address, fee payer.</p>
          </div>
          <div class="rx-step">
            <div class="rx-node" aria-hidden="true"></div>
            <div class="rx-mono rx-accent" style="font-size:11px;letter-spacing:.08em">02 · USDC ON ALGORAND</div>
            <h3 class="text-xl font-semibold mt-2">Settle once</h3>
            <p class="text-sm text-muted-foreground mt-2">Your client signs, GoPlausible verifies and settles on Algorand. Every route shares one merchant address.</p>
          </div>
          <div class="rx-step">
            <div class="rx-node" aria-hidden="true"></div>
            <div class="rx-mono rx-accent" style="font-size:11px;letter-spacing:.08em">03 · DUAL RECEIPTS</div>
            <h3 class="text-xl font-semibold mt-2">Fulfilled cross-chain</h3>
            <p class="text-sm text-muted-foreground mt-2">Roam402 pays the origin on its home chain and streams the response back with receipts from both chains. If the origin fails, you are never charged.</p>
          </div>
        </div>
      </div>

      <div class="w-full max-w-6xl mx-auto mt-10 reveal" style="--rd:.1s">
        <div class="rx-code" aria-label="Example x402 flow"><span class="c">$</span> curl ${gatewayHost}/trust?domain=blockrun.ai
<span class="b">HTTP/1.1 402 Payment Required</span>            <span class="c"># x402 challenge: price, payTo, feePayer</span>
<span class="c">$</span> curl ${gatewayHost}/trust?domain=blockrun.ai <span class="c">-H</span> "X-PAYMENT: &lt;signed&gt;"
<span class="g">HTTP/1.1 200 OK</span>                          <span class="c"># body + Algorand receipt + origin receipt</span></div>
      </div>

      <div class="w-full max-w-6xl mx-auto rx-caps reveal" style="--rd:.15s">
        <div class="rx-cap">${LUCIDE.chart}<div><b>Census-vetted catalog</b><p>Tiers, prices, and liveness come from the Agents-Trust census of $45M+ in settlement, not a directory scrape.</p></div></div>
        <div class="rx-cap">${LUCIDE.shield}<div><b>Precheck before paying</b><p>/precheck and /trust vet seller identity, tier, and liveness before any funds move.</p></div></div>
        <div class="rx-cap">${LUCIDE.wallet}<div><b>One merchant payTo</b><p>All ${n} routes settle to a single Algorand address, so treasury audit stays trivial.</p></div></div>
      </div>
    </div>

    <!-- ── Live catalog ───────────────────────────────────────────────── -->
    <div class="relative flex flex-col items-center justify-center w-full py-20">
      <div class="w-full h-full reveal">
        <div class="flex flex-col items-center text-center max-w-3xl mx-auto mb-16">
          <h2 class="text-2xl md:text-4xl lg:text-5xl font-heading font-medium !leading-snug">A catalog that is <span class="font-subheading italic">alive</span></h2>
          <p class="text-base md:text-lg text-accent-foreground/80 mt-4">These rows render from the same worker that serves the 402s. The machine-readable catalog is free at /catalog, and down routes refuse before payment.</p>
        </div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 relative w-full">
        <div class="w-full h-full reveal">
          <div class="rounded-2xl bg-background/40 relative border border-border/50">
            <div class="group relative flex size-full rounded-xl p-4 lg:p-8 w-full overflow-hidden">
              <div class="absolute inset-px z-10 rounded-xl rx-inner"></div>
              <div class="relative z-30 w-full">
                <div class="absolute bottom-0 right-0 bg-blue-500 w-1/4 h-1/4 blur-[8rem] z-20"></div>
                <div class="space-y-4">
                  <h3 class="text-xl font-semibold">Wrapped catalog routes</h3>
                  <p class="text-sm text-muted-foreground">Verified x402 services, callable in USDC on Algorand today.</p>
                  <div class="space-y-4">
                    <div class="flex justify-between items-baseline">
                      <div>
                        <div class="text-3xl font-semibold rx-mono">${n} routes</div>
                        <div class="text-sm text-green-500 flex items-center gap-1 mt-2">${LUCIDE.trend}${services} services · liveness probed</div>
                      </div>
                      <div class="flex gap-2">
                        <button aria-label="Filter" class="${BTN} hover:bg-white/10 hover:text-accent-foreground h-8 w-8">${LUCIDE.filter}</button>
                        <a href="/catalog" aria-label="Full catalog JSON"><button class="${BTN} hover:bg-white/10 hover:text-accent-foreground h-8 w-8">${LUCIDE.download}</button></a>
                      </div>
                    </div>
                    <div class="space-y-2">
                      <div class="grid rx-t-grid text-sm text-muted-foreground py-2">
                        <div>Route</div><div>Service</div><div>Tier</div><div>Price</div>
                      </div>
          ${catalogPreviewRows()}
                    </div>
                    <p class="text-sm text-muted-foreground pt-2">Full machine-readable catalog is free: <a class="rx-accent rx-mono" href="/catalog" style="font-size:12.5px">GET /catalog</a></p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="w-full h-full reveal" style="--rd:.1s">
          <div class="rounded-2xl bg-background/40 relative border border-border/50">
            <div class="group relative flex size-full rounded-xl p-4 lg:p-8 w-full overflow-hidden">
              <div class="absolute inset-px z-10 rounded-xl rx-inner"></div>
              <div class="relative z-30 w-full">
                <div class="absolute bottom-0 right-0 bg-sky-500 w-1/4 h-1/4 blur-[8rem] z-20"></div>
                <div class="space-y-4">
                  <h3 class="text-xl font-semibold">Native trust endpoints</h3>
                  <p class="text-sm text-muted-foreground">Seller verification and endpoint safety, straight from the census.</p>
                  <div class="space-y-4">
                    <div class="flex justify-between items-baseline">
                      <div>
                        <div class="text-3xl font-semibold rx-mono">$0.0002+</div>
                        <div class="text-sm text-green-500 flex items-center gap-1 mt-2">${LUCIDE.trend}micro-priced trust intelligence</div>
                      </div>
                    </div>
                    <div class="space-y-2">
                      <div class="grid rx-t-grid text-sm text-muted-foreground py-2">
                        <div>Endpoint</div><div>Path</div><div>Price</div><div>Status</div>
                      </div>
          ${nativeRows()}
                    </div>
                    <p class="text-sm text-muted-foreground pt-2">Pay per call, no key, no account. Try one in the <a class="rx-accent" href="/playground">playground</a>.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── CTA ────────────────────────────────────────────────────────── -->
    <div class="relative flex flex-col items-center justify-center w-full">
      <div class="w-full h-full py-20 max-w-6xl mx-auto reveal">
        <div class="relative flex flex-col items-center justify-center py-12 lg:py-20 px-4 rounded-2xl lg:rounded-3xl bg-background/20 text-center border border-foreground/20 overflow-hidden">
          <div class="absolute -bottom-1/8 left-1/3 -translate-x-1/2 w-44 h-32 lg:h-52 lg:w-1/3 rounded-full blur-[5rem] lg:blur-[10rem] -z-10" style="background:conic-gradient(from 0deg at 50% 50%, #818cf8 0deg, #4f46e5 180deg, #6366f1 360deg)"></div>
          <div class="rx-chainrow" aria-label="Algorand, Base, Solana, Ethereum">
            <span title="Algorand"><i class="m">${MARK_ALGORAND}</i></span>
            <span title="Base"><i class="m">${MARK_BASE}</i></span>
            <span title="Solana"><i class="m">${MARK_SOLANA}</i></span>
            <span title="Ethereum"><i class="m">${MARK_ETHEREUM}</i></span>
          </div>
          <div class="rx-eyebrow">ONE GATEWAY · EVERY CHAIN</div>
          <h2 class="text-3xl md:text-5xl lg:text-6xl font-heading font-medium !leading-snug">Ready to let your <br/>agents <span class="font-subheading italic">roam</span>?</h2>
          <p class="text-sm md:text-lg text-center text-accent-foreground/80 max-w-2xl mx-auto mt-4">Point any x402 client at the gateway. ${n} verified services, one USDC rail on Algorand, receipts from two chains.</p>
          <div class="flex items-center justify-center mt-8 gap-x-4">
            <a href="/catalog"><button class="${BTN} bg-primary text-primary-foreground hover:opacity-70 hover:ring-4 hover:ring-primary/10 h-10 px-8">Explore catalog</button></a>
            <a href="/llms.txt"><button class="${BTN} border border-input hover:bg-white/10 hover:text-accent-foreground h-10 px-8">Read agent spec</button></a>
          </div>
          <div class="rx-tags">
            <span class="rx-tag">npm i roam402</span>
            <span class="rx-tag">MCP server</span>
            <span class="rx-tag">x402 v2</span>
            <span class="rx-tag">USDC ASA ${cfg.chain.usdcAsaId}</span>
          </div>
        </div>
      </div>
    </div>

  </div>
</main>

<!-- ── Footer ─────────────────────────────────────────────────────────── -->
<footer class="footer flex flex-col relative items-center justify-center border-t border-foreground/5 pb-8 px-6 lg:px-8 w-full max-w-6xl mx-auto lg:pt-12 pt-8 gap-4">
  <div class="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-muted-foreground">
    <a class="link" href="/catalog">Catalog</a>
    <a class="link" href="/playground">Playground</a>
    <a class="link" href="/receipts">Receipts</a>
    <a class="link" href="/llms.txt">llms.txt</a>
    <a class="link" href="/.well-known/agents.json">agents.json</a>
  </div>
  <p class="text-sm text-muted-foreground md:mt-0 text-center">© 2026 Roam402 · built by <a class="rx-accent" href="https://agents-trust.com">Agents-Trust</a></p>
</footer>

<script>
(function () {
  /* reveal-on-scroll: deterministic sweep (an IntersectionObserver misses
     elements skipped over by instant jumps, e.g. anchor links) */
  var els = [].slice.call(document.querySelectorAll(".reveal"));
  function sweep() {
    els = els.filter(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < innerHeight * 0.92 || r.bottom < 0) { el.classList.add("in"); return false; }
      return true;
    });
    if (!els.length) removeEventListener("scroll", onScroll);
  }
  var queued = false;
  function onScroll() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; sweep(); });
  }
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  sweep();

  var btn = document.getElementById("menu-btn");
  var menu = document.getElementById("m-menu");
  if (btn && menu) {
    btn.addEventListener("click", function () {
      var open = menu.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    menu.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { menu.classList.remove("open"); });
    });
  }
})();
</script>
</body>
</html>`;
}

const LLMS_TXT = (n: number) => `# Roam402 | the x402 roaming gateway

Every verified x402 service from the Base/Solana economy, payable in USDC on
Algorand (facilitator: GoPlausible). ${n} wrapped routes + native trust
endpoints, one merchant address, dual-chain receipts.

## For agents
- GET /catalog — free machine-readable catalog (routes, prices, trust tiers)
- Any route: request without payment → HTTP 402 challenge (x402 v2,
  PAYMENT-REQUIRED header) → retry with X-PAYMENT.
- GET /trust?domain={domain} — Agents-Trust tier + score for any x402 seller
- GET /precheck?url={url} — safety check before paying an unknown endpoint

Operated by Agents-Trust (https://agents-trust.com) — the observatory
indexing $45M+ of real x402 settlement.
`;

export function mountLanding(app: Hono<AppEnv>, cfg: Config): void {
  app.get("/", (c) => c.html(page(cfg)));
  app.get("/llms.txt", (c) => c.text(LLMS_TXT(catalog.routes.length)));
  app.get("/.well-known/agents.json", (c) =>
    c.json({
      name: "Roam402",
      description:
        "x402 roaming gateway — the verified x402 economy payable in USDC on Algorand, with dual-chain receipts.",
      operator: { name: "Agents-Trust", url: "https://agents-trust.com" },
      payment: {
        protocol: "x402",
        network: cfg.chain.caip2,
        asset: `USDC (ASA ${cfg.chain.usdcAsaId})`,
        facilitator: cfg.facilitatorUrl,
      },
      interfaces: { catalog: "/catalog", trust: "/trust?domain=", precheck: "/precheck?url=" },
      tags: ["x402-global-challenge", "gateway", "trust"],
    })
  );
}
