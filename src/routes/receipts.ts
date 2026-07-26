/**
 * src/routes/receipts.ts — free transparency surface for the receipts log.
 *
 * /receipts.json — machine-readable recent settlements (no PII).
 * /receipts     — human page in the Agents-Trust design system.
 */

import { Hono } from "hono";
import type { AppEnv } from "../lib/appEnv";
import type { ReceiptStore } from "../receipts/store";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] as string));
}

export function mountReceipts(app: Hono<AppEnv>, store: ReceiptStore): void {
  app.get("/receipts.json", async (c) =>
    c.json({ enabled: store.enabled, receipts: await store.list() })
  );

  app.get("/receipts", async (c) => {
    const receipts = await store.list();
    const rows = receipts
      .slice(0, 100)
      .map(
        (r) => `<tr>
          <td class="mono muted">${esc(r.ts.slice(0, 19).replace("T", " "))}</td>
          <td class="mono ink">${esc(r.method)} ${esc(r.route)}</td>
          <td class="mono muted">${esc(r.service)}</td>
          <td class="mono money">$${r.priceUsd}</td>
          <td class="mono muted">${r.originReceipt ? `${esc(r.originReceipt.slice(0, 16))}…` : "—"}</td>
        </tr>`
      )
      .join("\n");
    return c.html(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Roam402 | Receipts</title>
<link href="https://fonts.googleapis.com/css2?family=Darker+Grotesque:wght@700;800&family=DM+Sans:wght@400;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
  body{background:#f4f5fb;color:#3b3f52;font-family:'DM Sans',system-ui,sans-serif;margin:0}
  .wrap{max-width:960px;margin:0 auto;padding:32px 24px}
  h1{font-family:'Darker Grotesque',sans-serif;font-weight:800;font-size:40px;color:#181a26;line-height:1.02;margin:0 0 6px}
  .sub{font-size:13px;color:#71768d;margin-bottom:20px}
  .card{background:#fff;border:1px solid #e2e5ee;border-radius:12px;overflow:auto;box-shadow:0 1px 2px rgba(13,14,21,.04)}
  table{width:100%;border-collapse:collapse;font-size:12px;min-width:640px}
  th{font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#969bb0;text-align:left;padding:12px 14px;border-bottom:1px solid #e2e5ee}
  td{padding:9px 14px;border-bottom:1px solid #e2e5ee}
  tr:last-child td{border-bottom:none}
  .mono{font-family:'DM Mono',ui-monospace,monospace}
  .ink{color:#0d0e15}.muted{color:#71768d}.money{color:#059669}
  .empty{padding:28px;text-align:center;color:#969bb0;font-size:13px}
  a{color:#4f46e5;text-decoration:none}
</style></head><body><div class="wrap">
<h1>Receipts</h1>
<p class="sub">Recent settled calls through the gateway — route, price, and the origin-chain
settlement reference. Public by design: this is the proof of who is paying.
<a href="/">← roam402</a> · <a href="/receipts.json">JSON</a></p>
<div class="card">
${
  rows
    ? `<table><thead><tr><th>Settled (UTC)</th><th>Route</th><th>Origin service</th><th>Price</th><th>Origin receipt</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty">${store.enabled ? "No settlements recorded yet." : "Receipts log not yet enabled on this deployment."}</div>`
}
</div></div></body></html>`);
  });
}
