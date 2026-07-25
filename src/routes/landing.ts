/**
 * src/routes/landing.ts — the merchant's public face, served by the worker.
 *
 * The Bazaar enriches merchant pages from domain metadata, so this page is
 * scoring surface, not vanity. Styling mirrors the Agents-Trust design
 * system exactly (Validatier-flavoured light theme): Darker Grotesque
 * display / DM Sans body / DM Mono numbers, lavender-white canvas #f4f5fb,
 * white cards, indigo #4f46e5 interactive, emerald #059669 money ink.
 *
 * Also serves the agentic discovery files (/llms.txt,
 * /.well-known/agents.json) the challenge checklist rewards.
 */

import { Hono } from "hono";
import type { Config } from "../config";
import { catalog } from "../catalog";
import { NATIVE_ROUTES } from "./native";
import { usdString } from "../pricing";

const TIER_INK: Record<string, string> = {
  Corroborated: "#059669",
  Established: "#4f46e5",
  Emerging: "#b45309",
};

function tierChip(tier: string): string {
  const ink = TIER_INK[tier] ?? "#71768d";
  return `<span class="chip" style="color:${ink}">${tier}</span>`;
}

function catalogRows(): string {
  return catalog.routes
    .slice(0, 10)
    .map(
      (r) => `<tr>
        <td><span class="method ${r.method === "POST" ? "post" : "get"}">${r.method}</span></td>
        <td class="mono path">/r/${r.slug}</td>
        <td class="mono svc">${r.service}</td>
        <td>${tierChip(r.tier)}</td>
        <td class="mono price">${usdString(r.roamPriceUsd)}</td>
      </tr>`
    )
    .join("\n");
}

function page(cfg: Config): string {
  const n = catalog.routes.length;
  const services = new Set(catalog.routes.map((r) => r.service)).size;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Roam402 — every x402 service, payable on Algorand</title>
<meta name="description" content="The x402 roaming gateway: ${n} verified services from the $45M+ x402 economy, payable in USDC on Algorand via the GoPlausible facilitator, fulfilled cross-chain with dual receipts. By Agents-Trust."/>
<meta property="og:title" content="Roam402 — every x402 service, payable on Algorand"/>
<meta property="og:description" content="${n} trust-tiered services · one Algorand merchant · dual-chain receipts. By Agents-Trust."/>
<meta name="theme-color" content="#f4f5fb"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Darker+Grotesque:wght@600;700;800&family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
  :root{
    --canvas:#f4f5fb; --card:#ffffff; --ink:#0d0e15; --head:#181a26;
    --body:#3b3f52; --muted:#71768d; --faint:#969bb0; --line:#e2e5ee;
    --indigo:#4f46e5; --indigo-bg:#edefff; --indigo-line:#cfd2fc;
    --money:#059669; --money-bg:#ecfdf3; --money-line:#c3f0dc;
    --display:'Darker Grotesque',ui-sans-serif,sans-serif;
    --sans:'DM Sans',ui-sans-serif,system-ui,sans-serif;
    --mono:'DM Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  *{box-sizing:border-box;margin:0}
  body{background:var(--canvas);color:var(--body);font-family:var(--sans);-webkit-font-smoothing:antialiased}
  a{color:var(--indigo);text-decoration:none}
  .wrap{max-width:960px;margin:0 auto;padding:0 24px}
  nav{display:flex;align-items:center;justify-content:space-between;padding:20px 0}
  .wordmark{font-family:var(--display);font-weight:800;font-size:26px;color:var(--ink);letter-spacing:-.01em}
  .wordmark .four{color:var(--indigo)}
  .byline{font-size:12px;color:var(--muted)}
  .byline a{font-weight:600}
  .eyebrow{font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
  .hero{padding:56px 0 40px}
  h1{font-family:var(--display);font-size:clamp(40px,7vw,64px);line-height:1.02;font-weight:800;color:var(--head);margin:10px 0 16px;letter-spacing:-.01em}
  h1 em{font-style:normal;color:var(--indigo)}
  .sub{font-size:16px;line-height:1.6;max-width:640px}
  .stats{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 18px;box-shadow:0 1px 2px rgba(13,14,21,.04)}
  .stat b{display:block;font-family:var(--mono);font-size:20px;color:var(--ink);font-weight:500}
  .stat span{font-size:11px;color:var(--muted)}
  .stat b.money{color:var(--money)}
  section{padding:28px 0}
  .h-section{font-family:var(--display);font-size:24px;line-height:1.05;font-weight:700;color:var(--head);margin-bottom:14px}
  .steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
  .step{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;box-shadow:0 1px 2px rgba(13,14,21,.04)}
  .step .k{font-family:var(--mono);font-size:11px;color:var(--indigo);font-weight:500}
  .step h3{font-family:var(--sans);font-size:14px;font-weight:700;color:var(--head);margin:6px 0 6px}
  .step p{font-size:13px;line-height:1.55;color:var(--muted)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 1px 2px rgba(13,14,21,.04);overflow:hidden}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);text-align:left;padding:12px 16px;border-bottom:1px solid var(--line)}
  td{padding:10px 16px;border-bottom:1px solid var(--line);vertical-align:middle}
  tr:last-child td{border-bottom:none}
  .mono{font-family:var(--mono)}
  .path{color:var(--ink)}
  .svc{color:var(--muted);font-size:12px}
  .price{color:var(--money);text-align:right}
  th:last-child{text-align:right}
  .method{font-family:var(--mono);font-size:10px;font-weight:500;padding:2px 7px;border-radius:6px;border:1px solid}
  .method.get{color:var(--money);background:var(--money-bg);border-color:var(--money-line)}
  .method.post{color:var(--indigo);background:var(--indigo-bg);border-color:var(--indigo-line)}
  .chip{font-size:11px;font-weight:600}
  .foot-note{padding:14px 16px;font-size:12px;color:var(--muted);border-top:1px solid var(--line)}
  .foot-note code{font-family:var(--mono);color:var(--indigo)}
  .native{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
  footer{padding:36px 0 48px;font-size:12px;color:var(--faint);display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between}
  .tag{font-family:var(--mono);font-size:11px;color:var(--muted)}
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <div class="wordmark">roam<span class="four">402</span></div>
    <div class="byline">by <a href="https://agents-trust.com">Agents-Trust</a></div>
  </nav>

  <div class="hero">
    <div class="eyebrow">x402 roaming gateway · Algorand ${cfg.network}</div>
    <h1>Every verified x402 service.<br/><em>One merchant on Algorand.</em></h1>
    <p class="sub">Agents on Algorand get the entire x402 economy — pay-per-call inference,
    token safety scans, market data, tools — through one gateway. Pay USDC on Algorand,
    settled by the GoPlausible facilitator; Roam402 fulfils the call on the service's home
    chain from its own treasury and returns the response with receipts from both chains.</p>
    <div class="stats">
      <div class="stat"><b>${n}</b><span>wrapped routes</span></div>
      <div class="stat"><b>${services}</b><span>verified services</span></div>
      <div class="stat"><b class="money">$45M+</b><span>settlement indexed by Agents-Trust</span></div>
      <div class="stat"><b>2</b><span>chains per receipt</span></div>
    </div>
  </div>

  <section>
    <div class="h-section">How it works</div>
    <div class="steps">
      <div class="step"><div class="k">01 · HTTP 402</div><h3>Call any route</h3>
        <p>GET or POST a route below with no payment — the gateway answers with an x402
        challenge: price in USDC, our Algorand address, the facilitator's fee-payer.</p></div>
      <div class="step"><div class="k">02 · PAY ON ALGORAND</div><h3>Settle in USDC</h3>
        <p>Your client signs the payment; GoPlausible verifies and settles it on Algorand.
        One merchant address for everything — spend tracking stays trivial.</p></div>
      <div class="step"><div class="k">03 · DUAL RECEIPTS</div><h3>Fulfilled cross-chain</h3>
        <p>We pay the origin service on its home chain from our treasury and stream the
        response back with both settlement receipts. Origin fails → you are never charged.</p></div>
    </div>
  </section>

  <section>
    <div class="h-section">Catalog preview</div>
    <div class="card">
      <table>
        <thead><tr><th></th><th>Route</th><th>Origin service</th><th>Trust tier</th><th>Price</th></tr></thead>
        <tbody>
${catalogRows()}
        </tbody>
      </table>
      <div class="foot-note">Full machine-readable catalog (free): <code>GET /catalog</code> ·
      trust tiers from the <a href="https://agents-trust.com">Agents-Trust census</a> ·
      only liveness-probed, trust-tiered services are wrapped.</div>
    </div>
  </section>

  <section>
    <div class="h-section">Native trust endpoints</div>
    <div class="native">
      ${NATIVE_ROUTES.map(
        (r) => `<div class="step"><div class="k">${usdString(r.priceUsd)} · GET ${r.path}</div>
        <p style="margin-top:8px">${r.description}</p></div>`
      ).join("\n")}
    </div>
  </section>

  <footer>
    <div>© 2026 Roam402 · by <a href="https://agents-trust.com">Agents-Trust</a> ·
    settles via <a href="https://facilitator.goplausible.xyz">GoPlausible</a></div>
    <div class="tag">#x402-global-challenge</div>
  </footer>
</div>
</body>
</html>`;
}

const LLMS_TXT = (n: number) => `# Roam402 — the x402 roaming gateway

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

export function mountLanding(app: Hono, cfg: Config): void {
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
