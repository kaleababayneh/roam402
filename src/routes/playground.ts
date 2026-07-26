/**
 * src/routes/playground.ts — /playground: try a paid call in the browser.
 *
 * Three tiers of interactivity, so the page is useful even before a wallet
 * is connected:
 *   1. Browse routes + prices (server-rendered from the catalog).
 *   2. "Inspect 402" — fires an unpaid same-origin request and pretty-prints
 *      the decoded PAYMENT-REQUIRED challenge (works for everyone, free).
 *   3. "Connect Pera & pay" — full x402 payment from the browser via
 *      esm.sh ESM builds of @x402/* + @perawallet/connect (beta).
 *
 * Styling mirrors the Agents-Trust design system (see landing.ts).
 */

import { Hono } from "hono";
import type { AppEnv } from "../lib/appEnv";
import type { Config } from "../config";
import { catalog } from "../catalog";
import { NATIVE_ROUTES } from "./native";
import { usdString } from "../pricing";

function options(): string {
  const native = NATIVE_ROUTES.map(
    (n) => `<option value="${n.path}" data-method="GET" data-price="${usdString(n.priceUsd)}">${n.path} · ${usdString(n.priceUsd)} · roam402 native</option>`
  );
  const wrapped = catalog.routes.map(
    (r) =>
      `<option value="/r/${r.slug}" data-method="${r.method}" data-price="${usdString(r.roamPriceUsd)}">/r/${r.slug} · ${usdString(r.roamPriceUsd)} · ${r.service}</option>`
  );
  return [...native, ...wrapped].join("\n");
}

function page(cfg: Config): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Roam402 | playground</title>
<link href="https://fonts.googleapis.com/css2?family=Darker+Grotesque:wght@700;800&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
  :root{--canvas:#f4f5fb;--card:#fff;--ink:#0d0e15;--head:#181a26;--body:#3b3f52;--muted:#71768d;--line:#e2e5ee;--indigo:#4f46e5;--money:#059669}
  *{box-sizing:border-box;margin:0}
  body{background:var(--canvas);color:var(--body);font-family:'DM Sans',system-ui,sans-serif}
  .wrap{max-width:880px;margin:0 auto;padding:28px 24px}
  h1{font-family:'Darker Grotesque',sans-serif;font-weight:800;font-size:42px;color:var(--head);line-height:1.02}
  .sub{font-size:13px;color:var(--muted);margin:6px 0 22px}
  a{color:var(--indigo);text-decoration:none}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;box-shadow:0 1px 2px rgba(13,14,21,.04);margin-bottom:14px}
  label{font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:6px}
  select,textarea,input{width:100%;font-family:'DM Mono',monospace;font-size:12px;color:var(--ink);background:var(--canvas);border:1px solid var(--line);border-radius:8px;padding:9px 10px}
  textarea{min-height:64px;resize:vertical}
  .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
  button{font-family:'DM Sans',sans-serif;font-weight:600;font-size:13px;border-radius:8px;padding:9px 16px;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--ink)}
  button.primary{background:var(--indigo);border-color:var(--indigo);color:#fff}
  button:disabled{opacity:.5;cursor:not-allowed}
  pre{background:#0d0e15;color:#e2e5ee;border-radius:10px;padding:14px;font-family:'DM Mono',monospace;font-size:11px;line-height:1.55;overflow:auto;max-height:420px;white-space:pre-wrap;word-break:break-word}
  .money{color:var(--money);font-weight:600}
  .beta{font-size:9px;font-weight:700;letter-spacing:.08em;color:#b45309;border:1px solid #fbe08f;background:#fffbeb;border-radius:99px;padding:2px 8px;vertical-align:middle}
  #wallet{font-family:'DM Mono',monospace;font-size:11px;color:var(--muted)}
</style></head><body><div class="wrap">
<h1>Playground</h1>
<p class="sub"><a href="/">← roam402</a> · pay-per-call the x402 economy in USDC on Algorand ${cfg.network} ·
GoPlausible facilitator · <a href="/receipts">receipts</a></p>

<div class="card">
  <label>Route</label>
  <select id="route">${options()}</select>
  <div id="bodyWrap" style="display:none;margin-top:12px">
    <label>JSON body (POST)</label>
    <textarea id="body">{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}</textarea>
  </div>
  <div id="queryWrap" style="margin-top:12px">
    <label>Query string (optional)</label>
    <input id="query" placeholder="domain=blockrun.ai"/>
  </div>
  <div class="row">
    <button id="inspect">Inspect 402 (free)</button>
    <button id="connect" class="primary">Connect Pera wallet</button>
    <button id="pay" class="primary" disabled>Pay & call <span class="beta">BETA</span></button>
    <span id="wallet"></span>
  </div>
</div>

<div class="card"><label>Result</label><pre id="out">Pick a route, then Inspect 402 to see the live payment challenge — price, our Algorand merchant address, and the x402-global-challenge tag. Connect Pera to make a real paid call.</pre></div>

<script type="module">
const $ = (id) => document.getElementById(id);
const out = (v) => { $("out").textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2); };
const routeUrl = () => {
  const q = $("query").value.trim();
  return location.origin + $("route").value + (q ? "?" + q : "");
};
const selected = () => $("route").selectedOptions[0];
$("route").addEventListener("change", () => {
  $("bodyWrap").style.display = selected().dataset.method === "POST" ? "block" : "none";
});

// ── Tier 2: decode the live 402 challenge (free) ─────────────────────────────
$("inspect").addEventListener("click", async () => {
  out("fetching unpaid → expecting 402…");
  const init = selected().dataset.method === "POST"
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: $("body").value }
    : {};
  const res = await fetch(routeUrl(), init);
  const pr = res.headers.get("PAYMENT-REQUIRED");
  if (res.status === 402 && pr) {
    const payload = JSON.parse(atob(pr));
    out({ status: 402, price: selected().dataset.price, challenge: payload });
  } else {
    out({ status: res.status, body: (await res.text()).slice(0, 2000) });
  }
});

// ── Tier 3 (beta): full payment from the browser via Pera ────────────────────
let payingFetch = null;
$("connect").addEventListener("click", async () => {
  try {
    out("loading wallet + x402 modules…");
    const [{ PeraWalletConnect }, core, avm, fetchMod] = await Promise.all([
      import("https://esm.sh/@perawallet/connect@1.4.2"),
      import("https://esm.sh/@x402/core@2.19.0/client"),
      import("https://esm.sh/@x402/avm@2.19.0/exact/client?deps=algosdk@3.6.0"),
      import("https://esm.sh/@x402/fetch@2.19.0"),
    ]);
    const pera = new PeraWalletConnect();
    const accounts = await pera.connect().catch(async (e) => {
      if (String(e).includes("Session currently connected")) return pera.reconnectSession();
      throw e;
    });
    const address = accounts[0];
    // Pera adapter → ClientAvmSigner: decode unsigned txn bytes, let Pera sign.
    const algosdk = (await import("https://esm.sh/algosdk@3.6.0")).default;
    const signer = {
      address,
      async signTransactions(txns, indexes) {
        const groups = txns.map((raw) => [{ txn: algosdk.decodeUnsignedTransaction(raw), signers: [address] }]);
        const toSign = indexes ? indexes.map((i) => groups[i]) : groups;
        const signed = await pera.signTransaction(toSign);
        let k = 0;
        return txns.map((_, i) => (!indexes || indexes.includes(i) ? signed[k++] : null));
      },
    };
    const client = new core.x402Client().register(${JSON.stringify(cfg.chain.caip2)}, new avm.ExactAvmScheme(signer));
    payingFetch = fetchMod.wrapFetchWithPayment(fetch, client);
    $("wallet").textContent = address.slice(0, 10) + "…";
    $("pay").disabled = false;
    out("wallet connected: " + address + "\\nready to pay — pick a cheap route and hit Pay & call.");
  } catch (err) {
    out("wallet error: " + (err?.message ?? err));
  }
});

$("pay").addEventListener("click", async () => {
  if (!payingFetch) return;
  try {
    out("paying " + selected().dataset.price + " + calling…");
    const init = selected().dataset.method === "POST"
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: $("body").value }
      : {};
    const res = await payingFetch(routeUrl(), init);
    const text = await res.text();
    out({
      status: res.status,
      receipts: {
        algorand: res.headers.get("PAYMENT-RESPONSE")?.slice(0, 60) ?? null,
        origin: res.headers.get("X-Roam-Origin-Receipt")?.slice(0, 60) ?? null,
        tier: res.headers.get("X-Roam-Trust-Tier"),
      },
      body: text.slice(0, 3000),
    });
  } catch (err) {
    out("payment error: " + (err?.message ?? err));
  }
});
</script>
</div></body></html>`;
}

export function mountPlayground(app: Hono<AppEnv>, cfg: Config): void {
  app.get("/playground", (c) => c.html(page(cfg)));
}
