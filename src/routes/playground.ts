/**
 * src/routes/playground.ts — /playground: try a paid call in the browser.
 *
 * The flow is deliberately un-losable:
 *   1 · Route  — search the whole catalog (server-side /catalog?q=), pick,
 *                see method · price · tier · what the service does.
 *   2 · Inputs — labeled fields generated from GET /schema?route=… (the
 *                origin's own published declaration): required fields carry
 *                an asterisk and block "Pay" until filled; optional ones
 *                don't. Services that publish nothing get a structured
 *                name/value builder, so a bare "elonmusk" can't happen.
 *   3 · Call   — Inspect 402 (free, always) or Pay & call via Pera (beta).
 *                Results open with a human sentence (incl. the origin's own
 *                error text via `hint`); raw JSON below for the curious.
 *
 * Styling mirrors the Agents-Trust design system (see landing.ts).
 */

import { Hono } from "hono";
import type { AppEnv } from "../lib/appEnv";
import type { Config } from "../config";
import { catalog } from "../catalog";
import { NATIVE_ROUTES } from "./native";
import { usdString } from "../pricing";
import { routeLabel } from "../lib/routeText";

/** Picker cap for the server-rendered initial list; search covers the rest. */
const PICKER_MAX = 150;

function optionTag(value: string, method: string, price: string, service: string, tier: string, desc: string, label: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<option value="${esc(value)}" data-method="${esc(method)}" data-price="${esc(price)}" data-service="${esc(service)}" data-tier="${esc(tier)}" data-desc="${esc(desc.slice(0, 180))}">${esc(label)}</option>`;
}

function options(): string {
  const native = NATIVE_ROUTES.map((n) =>
    optionTag(n.path, "GET", usdString(n.priceUsd), "roam402 native", "Native", n.description, `${n.path} · ${usdString(n.priceUsd)} · roam402 native`)
  );
  const wrapped = catalog.routes
    .slice(0, PICKER_MAX)
    .map((r) =>
      // routeLabel: the origin's own description of the endpoint when it
      // publishes one, so the picker matches what /catalog and /marketplace say.
      optionTag(`/r/${r.slug}`, r.method, usdString(r.roamPriceUsd), r.service, r.tier, routeLabel(r.description, r.slug), `/r/${r.slug} · ${usdString(r.roamPriceUsd)} · ${r.service}`)
    );
  return [...native, ...wrapped].join("\n");
}

function page(cfg: Config): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Roam402 | playground</title>
<link href="https://fonts.googleapis.com/css2?family=Darker+Grotesque:wght@700;800&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
  :root{--canvas:#f4f5fb;--card:#fff;--ink:#0d0e15;--head:#181a26;--body:#3b3f52;--muted:#71768d;--line:#e2e5ee;--indigo:#4f46e5;--money:#059669;--warn:#b45309;--err:#b91c1c}
  *{box-sizing:border-box;margin:0}
  body{background:var(--canvas);color:var(--body);font-family:'DM Sans',system-ui,sans-serif}
  .wrap{max-width:880px;margin:0 auto;padding:28px 24px}
  h1{font-family:'Darker Grotesque',sans-serif;font-weight:800;font-size:42px;color:var(--head);line-height:1.02}
  .sub{font-size:13px;color:var(--muted);margin:6px 0 22px}
  a{color:var(--indigo);text-decoration:none}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;box-shadow:0 1px 2px rgba(13,14,21,.04);margin-bottom:14px}
  label{font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:6px}
  .step{color:var(--indigo);font-family:'DM Mono',monospace;margin-right:6px}
  select,textarea,input{width:100%;font-family:'DM Mono',monospace;font-size:12px;color:var(--ink);background:var(--canvas);border:1px solid var(--line);border-radius:8px;padding:9px 10px}
  textarea{min-height:64px;resize:vertical}
  input:focus,select:focus,textarea:focus{outline:2px solid rgba(79,70,229,.35);outline-offset:1px}
  .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;align-items:center}
  button{font-family:'DM Sans',sans-serif;font-weight:600;font-size:13px;border-radius:8px;padding:9px 16px;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--ink)}
  button.primary{background:var(--indigo);border-color:var(--indigo);color:#fff}
  button:disabled{opacity:.5;cursor:not-allowed}
  pre{background:#0d0e15;color:#e2e5ee;border-radius:10px;padding:14px;font-family:'DM Mono',monospace;font-size:11px;line-height:1.55;overflow:auto;max-height:420px;white-space:pre-wrap;word-break:break-word}
  .money{color:var(--money);font-weight:600}
  .beta{font-size:9px;font-weight:700;letter-spacing:.08em;color:#b45309;border:1px solid #fbe08f;background:#fffbeb;border-radius:99px;padding:2px 8px;vertical-align:middle}
  #wallet{font-family:'DM Mono',monospace;font-size:11px;color:var(--muted)}
  #meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px;font-size:12px}
  .chip{font-family:'DM Mono',monospace;font-size:10.5px;border:1px solid var(--line);border-radius:99px;padding:2px 9px;background:var(--canvas);color:var(--body)}
  .chip.get{color:var(--money);border-color:#c3f0dc;background:#ecfdf3}
  .chip.post{color:var(--indigo);border-color:#cfd2fc;background:#edefff}
  #desc{font-size:12px;color:var(--muted);margin-top:8px;line-height:1.5}
  .f{margin-top:12px}
  .f label{text-transform:none;letter-spacing:0;font-size:12.5px;font-weight:600;color:var(--head)}
  .f .req{color:var(--err);margin-left:2px}
  .f .opt{color:var(--muted);font-weight:400;font-size:11px;margin-left:6px}
  .f .help{font-size:11.5px;color:var(--muted);margin-top:4px}
  .kvrow{display:flex;gap:8px;margin-top:8px}
  .kvrow input{flex:1}
  .kvrow .k{flex:0 0 36%}
  .ghost{font-size:12px;padding:6px 12px}
  #note{font-size:11.5px;color:var(--muted);margin-top:10px;line-height:1.5}
  #summary{font-size:13px;line-height:1.5;margin-bottom:10px;display:none;border:1px solid var(--line);border-radius:8px;padding:10px 12px}
  #summary.ok{display:block;color:var(--money);border-color:#c3f0dc;background:#ecfdf3}
  #summary.err{display:block;color:var(--err);border-color:#f3d1d1;background:#fef2f2}
  #summary.info{display:block;color:var(--body);background:var(--canvas)}
  #summary a{color:inherit;font-weight:600;text-decoration:underline;margin-left:12px}
  #schemaState{font-size:11.5px;color:var(--muted);margin-top:10px}
</style></head><body><div class="wrap">
<h1>Playground</h1>
<p class="sub"><a href="/">← roam402</a> · pay-per-call the x402 economy in USDC on Algorand ${cfg.network} ·
GoPlausible facilitator · <a href="/receipts">receipts</a> · ${catalog.routes.length} routes — <a href="/catalog">full catalog</a></p>

<div class="card">
  <label><span class="step">1</span>Route</label>
  <input id="search" placeholder="Search all ${catalog.routes.length} routes — try: twitter, token scan, llm…" autocomplete="off" style="margin-bottom:8px"/>
  <select id="route" size="0">${options()}</select>
  <div id="meta"></div>
  <div id="desc"></div>
</div>

<div class="card">
  <label><span class="step">2</span>Inputs</label>
  <div id="schemaState">reading what this service expects…</div>
  <div id="params"></div>
  <div id="bodyWrap" style="display:none">
    <div id="bodyForm"></div>
    <div class="f" id="bodyRaw"><label for="body">JSON body <span class="opt">POST</span></label>
    <textarea id="body">{}</textarea></div>
    <div id="bodyHint" class="help" style="margin-top:6px"></div>
  </div>
  <div id="note"></div>
  <div class="row">
    <button id="inspect">Inspect 402 (free)</button>
    <button id="connect" class="primary">Connect Pera wallet</button>
    <button id="pay" class="primary" disabled>Pay &amp; call <span class="beta">BETA</span></button>
    <span id="wallet"></span>
  </div>
</div>

<div class="card"><label><span class="step">3</span>Result</label>
  <div id="summary"></div>
  <pre id="out">Pick a route above — required inputs are marked with *. Inspect 402 shows the live payment challenge for free; Connect Pera to make a real paid call.</pre>
</div>

<script type="module">
const $ = (id) => document.getElementById(id);
const out = (v) => { $("out").textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2); };
const summary = (kind, text) => { const s = $("summary"); s.className = kind || ""; s.textContent = text || ""; };
const selected = () => $("route").selectedOptions[0];

/* ── route metadata line ─────────────────────────────────────────────────── */
const TIER_INK = { Corroborated: "#059669", Established: "#4f46e5", Emerging: "#b45309", Native: "#4f46e5" };
function renderMeta() {
  const o = selected(); if (!o) return;
  const meta = $("meta"); meta.textContent = "";
  const m = document.createElement("span");
  m.className = "chip " + (o.dataset.method === "POST" ? "post" : "get");
  m.textContent = o.dataset.method;
  const p = document.createElement("span"); p.className = "money"; p.textContent = o.dataset.price + " USDC";
  const s = document.createElement("span"); s.textContent = o.dataset.service; s.style.color = "var(--muted)";
  const t = document.createElement("span"); t.textContent = o.dataset.tier;
  t.style.cssText = "font-weight:600;font-size:11px;color:" + (TIER_INK[o.dataset.tier] || "#71768d");
  meta.append(m, p, s, t);
  $("desc").textContent = o.dataset.desc || "";
  $("pay").innerHTML = "";
  $("pay").append("Pay " + o.dataset.price + " & call\\u00a0");
  const b = document.createElement("span"); b.className = "beta"; b.textContent = "BETA";
  $("pay").append(b);
}

/* ── schema-driven input fields ──────────────────────────────────────────── */
let schemaAbort = null;
function fieldRow(param) {
  const f = document.createElement("div"); f.className = "f";
  const lab = document.createElement("label");
  lab.textContent = param.name;
  if (param.required) { const r = document.createElement("span"); r.className = "req"; r.textContent = " *"; lab.append(r); }
  else { const opt = document.createElement("span"); opt.className = "opt"; opt.textContent = "optional"; lab.append(opt); }
  const inp = document.createElement("input");
  inp.dataset.param = param.name;
  if (param.required) inp.dataset.required = "1";
  if (param.example) inp.setAttribute("placeholder", param.example);
  f.append(lab, inp);
  if (param.description) { const h = document.createElement("div"); h.className = "help"; h.textContent = param.description; f.append(h); }
  return f;
}
/* ── POST body → plain input fields (JSON assembled behind the scenes) ──── */
let bodyFields = null;
function renderBodyForm(exampleJson) {
  bodyFields = null;
  const host = $("bodyForm"); host.textContent = "";
  let obj = null;
  try { obj = JSON.parse(exampleJson); } catch { /* raw fallback */ }
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || !Object.keys(obj).length) return false;
  const fields = [];
  for (const [key, val] of Object.entries(obj)) {
    const f = document.createElement("div"); f.className = "f";
    const lab = document.createElement("label");
    if (Array.isArray(val) && val.length && val[0] && typeof val[0] === "object" && val[0] !== null && "content" in val[0]) {
      lab.textContent = key.replace(/s$/, "");
      const inp = document.createElement("input");
      inp.setAttribute("placeholder", String(val[0].content ?? ""));
      f.append(lab, inp);
      fields.push({ kind: "chat", key, role: String(val[0].role ?? "user"), el: inp, example: String(val[0].content ?? "") });
    } else if (val !== null && typeof val === "object") {
      lab.textContent = key;
      const ta = document.createElement("textarea");
      ta.setAttribute("placeholder", JSON.stringify(val, null, 2)); ta.style.minHeight = "56px";
      f.append(lab, ta);
      fields.push({ kind: "json", key, el: ta, example: val });
    } else if (typeof val === "boolean") {
      lab.textContent = key;
      const inp = document.createElement("input");
      inp.setAttribute("placeholder", String(val));
      f.append(lab, inp);
      const h = document.createElement("div"); h.className = "help"; h.textContent = "true or false"; f.append(h);
      fields.push({ kind: "bool", key, el: inp, example: val });
    } else {
      lab.textContent = key;
      const inp = document.createElement("input");
      inp.setAttribute("placeholder", String(val));
      f.append(lab, inp);
      fields.push({ kind: typeof val === "number" ? "number" : "string", key, el: inp, example: val });
    }
    host.append(f);
  }
  bodyFields = fields;
  return true;
}
function buildBody() {
  if (!bodyFields) return $("body").value;
  const o = {};
  for (const f of bodyFields) {
    const v = f.el.value;
    const empty = v.trim() === "";
    if (f.kind === "chat") o[f.key] = [{ role: f.role, content: empty ? f.example : v }];
    else if (f.kind === "json") {
      if (empty) o[f.key] = f.example;
      else {
        try { o[f.key] = JSON.parse(v); }
        catch { const e = new Error("The \u201C" + f.key + "\u201D field isn't valid JSON \u2014 fix it and try again."); throw e; }
      }
    } else if (f.kind === "number") { const n = Number(v); o[f.key] = empty ? f.example : Number.isFinite(n) ? n : v; }
    else if (f.kind === "bool") o[f.key] = empty ? f.example : /^true$/i.test(v.trim());
    else o[f.key] = empty ? f.example : v;
  }
  return JSON.stringify(o);
}
function initFor() {
  if (selected().dataset.method !== "POST") return {};
  let body;
  try { body = buildBody(); } catch (e) { summary("err", e.message); return null; }
  return { method: "POST", headers: { "Content-Type": "application/json" }, body };
}
function kvRow() {
  const row = document.createElement("div"); row.className = "kvrow";
  const k = document.createElement("input"); k.className = "k"; k.setAttribute("placeholder", "name (e.g. username)"); k.dataset.kvk = "1";
  const v = document.createElement("input"); v.setAttribute("placeholder", "value (e.g. elonmusk)"); v.dataset.kvv = "1";
  row.append(k, v);
  return row;
}
async function loadSchema() {
  const o = selected(); if (!o) return;
  const route = o.value;
  const params = $("params"); params.textContent = "";
  $("note").textContent = "";
  $("bodyWrap").style.display = o.dataset.method === "POST" ? "block" : "none";
  $("schemaState").textContent = "reading what this service expects…";
  if (schemaAbort) schemaAbort.abort();
  const ctrl = new AbortController(); schemaAbort = ctrl;
  let sch = null;
  let schErr = false;
  try {
    const res = await fetch("/schema?route=" + encodeURIComponent(route), { signal: ctrl.signal, cache: "no-store" });
    if (res.ok) sch = await res.json();
    else schErr = true;
  } catch (e) {
    if (ctrl.signal.aborted) return;
    schErr = true;
  }
  if (ctrl.signal.aborted || selected()?.value !== route) return;

  if (sch && Array.isArray(sch.params) && sch.params.length) {
    $("schemaState").textContent =
      sch.source === "native" ? "" :
      sch.source === "origin-402" ? "inputs published by the service itself:" :
      sch.source === "description" ? "inputs hinted by the route description:" :
      "inputs inferred from the service's validation:";
    for (const p of sch.params) params.append(fieldRow(p));
  } else if (o.dataset.method === "POST") {
    $("schemaState").textContent = "";
  } else if (sch && (sch.source === "native" || Array.isArray(sch.params))) {
    $("schemaState").textContent = sch.bare
      ? "No inputs needed — the service accepts a bare paid call (verified by a free probe)."
      : "This route takes no inputs — just call it" + (sch.source === "origin-402" ? " (the service declares none)." : ".");
  } else {
    $("schemaState").textContent = schErr
      ? "Couldn't reach the gateway to read this route's inputs — is the dev server still running? Re-select the route to retry, or add name/value pairs below."
      : "This service doesn't publish parameter names — add what it needs as name/value pairs (its docs or description usually say).";
    params.append(kvRow());
    const add = document.createElement("button"); add.className = "ghost"; add.type = "button";
    add.textContent = "+ add parameter"; add.style.marginTop = "8px";
    add.addEventListener("click", () => params.insertBefore(kvRow(), add));
    params.append(add);
  }
  if (o.dataset.method === "POST") {
    const example = sch && sch.bodyExample ? sch.bodyExample : "{}";
    const built = renderBodyForm(example);
    $("body").value = example;
    $("bodyRaw").style.display = built ? "none" : "block";
    $("bodyHint").textContent = built ? "" : "This service publishes no body shape — send raw JSON.";
  } else {
    bodyFields = null;
  }
  const noteUseful = sch && sch.note && sch.source !== "native" &&
    (sch.source === "origin-402" || (!bodyFields && !(sch.params && sch.params.length)));
  $("note").textContent = noteUseful ? "service note: " + sch.note : "";
  updatePayState();
}

/* ── query building + validation ─────────────────────────────────────────── */
function buildQuery() {
  const q = new URLSearchParams();
  for (const inp of $("params").querySelectorAll("input[data-param]")) {
    const v = inp.value.trim(); if (v) q.append(inp.dataset.param, v);
  }
  const rows = $("params").querySelectorAll(".kvrow");
  for (const row of rows) {
    const k = row.querySelector("[data-kvk]").value.trim();
    const v = row.querySelector("[data-kvv]").value.trim();
    if (k && v) q.append(k, v);
  }
  const s = q.toString();
  return s ? "?" + s : "";
}
function missingRequired() {
  const missing = [];
  for (const inp of $("params").querySelectorAll("input[data-required]")) {
    if (!inp.value.trim()) missing.push(inp.dataset.param);
  }
  return missing;
}
let walletReady = false;
function updatePayState() {
  const missing = missingRequired();
  $("pay").disabled = !walletReady || missing.length > 0;
  $("pay").title = missing.length ? "Fill required field" + (missing.length > 1 ? "s" : "") + ": " + missing.join(", ") : "";
}
$("params").addEventListener("input", updatePayState);
const routeUrl = () => location.origin + $("route").value + buildQuery();

/* ── catalog search (server-side, whole catalog) ─────────────────────────── */
const initialOptions = $("route").innerHTML;
let searchTimer = null;
$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = $("search").value.trim();
    const sel = $("route");
    if (!q) { sel.innerHTML = initialOptions; sel.selectedIndex = 0; renderMeta(); loadSchema(); return; }
    try {
      const res = await fetch("/catalog?q=" + encodeURIComponent(q) + "&limit=100");
      const data = await res.json();
      sel.textContent = "";
      for (const w of data.wrapped ?? []) {
        const o = document.createElement("option");
        o.value = w.path;
        o.dataset.method = w.method || "GET";
        o.dataset.price = w.price || "";
        o.dataset.service = w.service || "";
        o.dataset.tier = w.trust_tier || "";
        o.dataset.desc = (w.description || "").slice(0, 180);
        o.textContent = w.path + " · " + (w.price || "") + " · " + (w.service || "");
        sel.append(o);
      }
      if (!sel.options.length) {
        const o = document.createElement("option");
        o.disabled = true; o.textContent = "no routes match \\u201C" + q + "\\u201D";
        sel.append(o);
      } else { sel.selectedIndex = 0; renderMeta(); loadSchema(); }
    } catch { /* keep current list on search failure */ }
  }, 250);
});
$("route").addEventListener("change", () => { renderMeta(); loadSchema(); });

/* Deep link from the marketplace: /playground?route=<slug|/r/slug>.
   The picker only holds a page of options, so a slug that isn't loaded yet is
   fetched by name before selecting. */
(async function preselect() {
  const raw = new URLSearchParams(location.search).get("route");
  if (!raw) return;
  const path = raw.startsWith("/r/") ? raw : "/r/" + raw;
  const sel = $("route");
  const find = () => [...sel.options].find((o) => o.value === path);
  if (!find()) {
    try {
      const res = await fetch("/catalog?q=" + encodeURIComponent(path.slice(3)) + "&limit=100");
      const data = await res.json();
      sel.textContent = "";
      for (const w of data.wrapped ?? []) {
        const o = document.createElement("option");
        o.value = w.path;
        o.dataset.method = w.method || "GET";
        o.dataset.price = w.price || "";
        o.dataset.service = w.service || "";
        o.dataset.tier = w.trust_tier || "";
        o.dataset.desc = (w.description || "").slice(0, 180);
        o.textContent = w.path + " \\u00b7 " + (w.price || "") + " \\u00b7 " + (w.service || "");
        sel.append(o);
      }
    } catch { /* fall through: leave the default list in place */ }
  }
  const hit = find();
  if (hit) { sel.value = hit.value; $("search").value = path.slice(3); }
  renderMeta(); loadSchema();
})();

/* ── result interpretation ───────────────────────────────────────────────── */
function decodeReceipt(raw) {
  if (!raw) return null;
  try {
    const b = raw.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
  } catch { return raw.slice(0, 80) + "\u2026"; }
}
function parseBody(text) {
  try { return JSON.parse(text); } catch { return text.slice(0, 5000); }
}
function humanHint(hint) {
  try {
    const j = JSON.parse(hint);
    const inner = j?.error?.message ?? j?.message ?? j?.error ?? hint;
    return typeof inner === "string" ? inner : JSON.stringify(inner);
  } catch { return hint; }
}
function explainFailure(status, bodyText) {
  let j = null; try { j = JSON.parse(bodyText); } catch { /* not json */ }
  const hint = j && j.hint ? " The service said: \\u201C" + humanHint(j.hint) + "\\u201D." : "";
  const code = j && j.error;
  if (code === "origin_error") return "The origin rejected the call, so you were NOT charged." + hint + " Check the inputs above and try again.";
  if (code === "origin_timeout") return "The origin timed out — you were not charged. Usually transient; try again.";
  if (code === "origin_unhealthy") return "This route is paused (the origin keeps failing) — you were not charged. Pick another route.";
  if (code === "kill_switch") return "The gateway is paused by the operator — nothing was charged.";
  if (code === "spend_cap") return "This route costs more than the per-request cap, so the gateway refused before payment.";
  return "Call failed with HTTP " + status + " — nothing was charged." + hint;
}

/* ── Tier 2: decode the live 402 challenge (free) ─────────────────────────── */
$("inspect").addEventListener("click", async () => {
  summary("", "");
  const init = initFor();
  if (init === null) return;
  out("fetching unpaid → expecting 402…");
  const res = await fetch(routeUrl(), init);
  const pr = res.headers.get("PAYMENT-REQUIRED");
  if (res.status === 402 && pr) {
    const b64 = pr.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    summary("info", "This is the live payment challenge — the price, our Algorand merchant address, and the facilitator fee-payer your wallet would sign for. No payment was made.");
    out({ status: 402, price: selected().dataset.price, challenge: payload });
  } else {
    const text = await res.text();
    if (res.status >= 400) summary("err", explainFailure(res.status, text));
    out({ status: res.status, body: parseBody(text) });
  }
});

/* ── Tier 3 (beta): full payment from the browser via Pera ────────────────── */
let payingFetch = null;
$("connect").addEventListener("click", async () => {
  try {
    out("loading wallet + x402 modules…");
    const [{ PeraWalletConnect }, core, avm, fetchMod] = await Promise.all([
      import("/js/pera-connect.js"),
      import("https://esm.sh/@x402/core@2.19.0/client?bundle"),
      import("https://esm.sh/@x402/avm@2.19.0/exact/client?bundle&deps=algosdk@3.6.0"),
      import("https://esm.sh/@x402/fetch@2.19.0?bundle"),
    ]);
    // Declare our network to Pera up front (416001 mainnet / 416002 testnet)
    // so a wallet on the wrong network fails at connect, not at signing.
    const pera = new PeraWalletConnect({ chainId: ${cfg.network === "mainnet" ? 416001 : 416002} });
    const accounts = await pera.connect().catch(async (e) => {
      if (String(e).includes("Session currently connected")) return pera.reconnectSession();
      throw e;
    });
    const address = accounts[0];
    // Pera adapter → ClientAvmSigner: decode unsigned txn bytes, let Pera sign.
    const algosdk = (await import("https://esm.sh/algosdk@3.6.0?bundle")).default;
    const signer = {
      address,
      async signTransactions(txns, indexes) {
        // Pera refuses partial groups ("Missing transactions") — it must SEE
        // the whole atomic group. signers:[] marks display-only entries (the
        // facilitator's fee-abstraction txn); we sign only our indexes.
        const want = new Set(indexes ?? txns.map((_, i) => i));
        const group = txns.map((raw, i) => ({
          txn: algosdk.decodeUnsignedTransaction(raw),
          signers: want.has(i) ? [address] : [],
        }));
        const res = await pera.signTransaction([group]);
        // SDK versions differ: full-length arrays with holes vs signed-only.
        const signedOnly = res.filter(Boolean);
        console.log("[roam402] pera returned", res.length, "entries,", signedOnly.length, "signed");
        let k = 0;
        return txns.map((_, i) => (want.has(i) ? signedOnly[k++] : null));
      },
    };
    const client = new core.x402Client().register(${JSON.stringify(cfg.chain.caip2)}, new avm.ExactAvmScheme(signer));
    payingFetch = fetchMod.wrapFetchWithPayment(fetch, client);
    $("wallet").textContent = address.slice(0, 10) + "…";
    walletReady = true;
    updatePayState();
    summary("info", "Wallet connected (Algorand ${cfg.network}). Fill the inputs, then Pay & call — you approve the exact amount in Pera before anything moves.");
    out("wallet connected: " + address);
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (/network mismatch|different networks/i.test(msg)) {
      summary("err", "Network mismatch: this gateway runs on Algorand ${cfg.network}, but your Pera app is on the other network. In Pera: Settings \u2192 Developer settings \u2192 Node settings \u2192 choose ${cfg.network === "mainnet" ? "Mainnet" : "Testnet"}, then reconnect.${cfg.network === "mainnet" ? "" : " (Production roam402.com runs mainnet \u2014 test real payments there.)"}");
    }
    out("wallet error: " + msg);
  }
});

$("pay").addEventListener("click", async () => {
  if (!payingFetch) return;
  try {
    summary("", "");
    const init = initFor();
    if (init === null) return;
    out("paying " + selected().dataset.price + " + calling…");
    const res = await payingFetch(routeUrl(), init);
    const text = await res.text();
    if (res.status === 402) {
      summary("err", "Payment signed but NOT accepted — no money moved. Likely: paying the merchant from its own wallet (connect a different funded wallet), or the challenge expired (try again and approve promptly).");
      out("details logged to the browser console.");
      return;
    }
    const alg = decodeReceipt(res.headers.get("PAYMENT-RESPONSE"));
    const org = decodeReceipt(res.headers.get("X-Roam-Origin-Receipt"));
    const tier = res.headers.get("X-Roam-Trust-Tier");
    if (res.ok) {
      const sEl = $("summary"); sEl.className = "ok";
      sEl.textContent = "\\u2713 " + res.status + " OK · paid " + selected().dataset.price + (tier ? " · tier " + tier : "");
      const link = (href, label) => {
        const a = document.createElement("a");
        a.href = href; a.target = "_blank"; a.rel = "noopener"; a.textContent = label;
        sEl.append(a);
      };
      if (alg && typeof alg === "object" && alg.transaction) {
        link("${cfg.network === "mainnet" ? "https://allo.info/tx/" : "https://lora.algokit.io/testnet/transaction/"}" + alg.transaction, "Algorand receipt \\u2197");
      }
      if (org && typeof org === "object" && org.transaction) {
        link((String(org.network ?? "").includes("84532") ? "https://sepolia.basescan.org/tx/" : "https://basescan.org/tx/") + org.transaction, "Base receipt \\u2197");
      }
    } else {
      summary("err", explainFailure(res.status, text));
    }
    out({ status: res.status, receipts: { algorand: alg, origin: org, tier }, body: parseBody(text) });
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (/network mismatch|different networks/i.test(msg)) {
      summary("err", "Network mismatch: this gateway runs on Algorand ${cfg.network}, but your Pera app is on the other network. In Pera: Settings \u2192 Developer settings \u2192 Node settings \u2192 choose ${cfg.network === "mainnet" ? "Mainnet" : "Testnet"}, then reconnect.${cfg.network === "mainnet" ? "" : " (Production roam402.com runs mainnet \u2014 test real payments there.)"}");
    } else {
      summary("err", "Payment failed before completing \u2014 nothing was charged unless a receipt shows above.");
    }
    out("payment error: " + msg);
  }
});

renderMeta();
loadSchema();
</script>
</div></body></html>`;
}

export function mountPlayground(app: Hono<AppEnv>, cfg: Config): void {
  app.get("/playground", (c) => c.html(page(cfg)));
}
