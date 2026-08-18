/**
 * src/routes/blog.ts — /blog and /blog/:slug.
 *
 * Posts are TypeScript, not a CMS: there are a handful, they ship with the
 * worker, and a deploy is the publish step. Bodies are written as HTML so the
 * page needs no markdown dependency at the edge — every value that could come
 * from outside is escaped, but here the author is the repo itself.
 */

import { Hono } from "hono";
import type { AppEnv } from "../lib/appEnv";
import type { Config } from "../config";
import { shell } from "../lib/shell";
import { catalog } from "../catalog";

interface Post {
  slug: string;
  title: string;
  /** One line for the index card and the meta description. */
  summary: string;
  /** ISO date; rendered as "17 August 2026". */
  date: string;
  readingMinutes: number;
  body: string;
}

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** Terminal transcript, rendered as a macOS-style window. `out` lines are
 *  muted, `cmd` lines get the prompt. */
const term = (lines: [kind: "cmd" | "out" | "note", text: string][], title = "zsh · roam402"): string =>
  `<div class="rx-term"><div class="rx-term-bar"><span class="rx-term-dot rx-dot-r"></span><span class="rx-term-dot rx-dot-y"></span><span class="rx-term-dot rx-dot-g"></span><span class="rx-term-title">${title}</span></div><div class="rx-term-body">${lines
    .map(([k, t]) =>
      k === "cmd"
        ? `<div class="rx-term-cmd"><span>❯</span>${t}</div>`
        : k === "note"
          ? `<div class="rx-term-note">${t}</div>`
          : `<div class="rx-term-out">${t}</div>`
    )
    .join("")}</div></div>`;

/** A Claude-style exchange. Tool results below are real output from the live
 *  gateway, not mock-ups — only the prose around them is written. */
type Turn =
  | { who: "user"; text: string }
  | { who: "claude"; text: string }
  | { who: "tool"; name: string; args: string; result: string };

const chat = (turns: Turn[]): string =>
  `<div class="rx-chat"><div class="rx-chat-bar"><span class="rx-chat-dot"></span>Claude</div>${turns
    .map((t) =>
      t.who === "user"
        ? `<div class="rx-msg rx-msg-user"><div class="rx-avatar rx-avatar-you">You</div><div class="rx-bubble">${t.text}</div></div>`
        : t.who === "claude"
          ? `<div class="rx-msg"><div class="rx-avatar rx-avatar-ai">✳</div><div class="rx-bubble rx-bubble-ai">${t.text}</div></div>`
          : `<div class="rx-tool"><div class="rx-tool-head"><span class="rx-tool-name">${t.name}</span><span class="rx-tool-args">${t.args}</span></div><pre class="rx-tool-out">${t.result}</pre></div>`
    )
    .join("")}</div>`;

const code = (lang: string, src: string): string =>
  `<div class="rx-code-block"><div class="rx-code-lang">${lang}</div><pre><code>${src}</code></pre></div>`;

/* ── Posts ────────────────────────────────────────────────────────────────── */

const GETTING_STARTED: Post = {
  slug: "give-your-agent-a-wallet",
  title: "Give your agent a wallet",
  summary:
    "From nothing to a paid API call in five minutes with the roam402 MCP server, the SDK, and the one Algorand detail that trips everybody up.",
  date: "2026-08-17",
  readingMinutes: 5,
  body: `
<p class="rx-lede">Roam402 is a roaming gateway for the x402 economy. Your agent pays in USDC
on Algorand and calls any of ${catalog.routes.length.toLocaleString("en-US")} verified routes
on Base, Solana, and Ethereum. Every response comes with a receipt from both chains.</p>

<p>There are two ways in. The <strong>MCP server</strong> gives any agent host (Claude Code,
Claude Desktop, Cursor) seven tools and needs no code. The <strong>SDK</strong> is four lines
of TypeScript. This post walks through both with a mainnet wallet.</p>

<h2 id="mcp">The MCP server</h2>

<p>You need an Algorand wallet with a little USDC. The setup wizard can make one. No wallet
app, no browser extension, no signup.</p>

${term([
  ["cmd", "npx roam402-mcp"],
  ["out", ""],
  ["out", "<b>roam402-mcp</b> — give your agent the x402 economy, paid in USDC on Algorand."],
  ["out", ""],
  ["out", "This is an <b>MCP server</b>: it is meant to be launched by an agent host"],
  ["out", "(Claude Code, Claude Desktop, Cursor), not run directly. It needs an Algorand"],
  ["out", "wallet to pay for calls — that wallet stays on this machine and only signed"],
  ["out", "payments ever leave it."],
  ["out", ""],
  ["out", "Create a new Algorand wallet now? [y/N] <b>y</b>"],
  ["out", ""],
  ["out", "<span class='g'>Wallet created.</span>  <b>Address</b>  3GE37VSG37CVDA3MZGLOP4TKO7OXFDZLXSPO6CK2KK343C4HV6REUDOJOM"],
  ["out", ""],
  ["out", "Its 25 words are saved to <b>~/.roam402/mainnet.mnemonic</b> (readable only by you)."],
  ["out", "<span class='w'>⚠  That file IS the wallet — anyone who reads it can spend it.</span>"],
])}

<p>The key goes to a file with <code>0600</code> permissions instead of your terminal, because
scrollback ends up in screenshots and pasted chats. Nothing that references it ever holds the
words themselves, only the path.</p>

<h3 id="funding">Fund it in the right order</h3>

<div class="rx-callout">
  <p> An Algorand account
  <em>cannot receive</em> an asset it has not opted into. The opt-in is a transaction the
  account signs <em>itself</em>, so it needs ALGO before it can accept USDC. Send USDC first
  and the transfer fails.</p>
</div>

<p>The order is ALGO, then opt in, then USDC.</p>

${term([
  ["note", "1. Send ~0.3 ALGO to the address from any exchange. No wallet app needed."],
  ["cmd", "npx roam402-mcp --status"],
  ["out", "address   3GE37VSG37CVDA3MZGLOP4TKO7OXFDZLXSPO6CK2KK343C4HV6REUDOJOM"],
  ["out", "network   mainnet"],
  ["out", "ALGO      0.2"],
  ["out", "USDC      not opted in — run: npx roam402-mcp --optin"],
  ["note", "2. Opt in. 0.2 ALGO is not quite enough. The error says why."],
  ["cmd", "npx roam402-mcp --optin"],
  ["out", "Not enough ALGO to opt in: this wallet holds 0.2 ALGO and needs ~0.21"],
  ["out", "(0.1 minimum balance + 0.1 more to hold an asset + fees)."],
  ["note", "Top it up and retry."],
  ["cmd", "npx roam402-mcp --optin"],
  ["out", "<span class='g'>Opted in to USDC (asset 31566704) on mainnet.</span>"],
  ["out", "Transaction KOLPQ75YMEFJGNTOUR7MN6NYCOXEX6LR2LKRL2HGQVPRLXSIGATA"],
  ["note", "3. Now send USDC."],
  ["cmd", "npx roam402-mcp --status"],
  ["out", "ALGO      0.299"],
  ["out", "USDC      0.1"],
])}

<p>That opt-in is <a href="https://allo.info/tx/KOLPQ75YMEFJGNTOUR7MN6NYCOXEX6LR2LKRL2HGQVPRLXSIGATA" target="_blank" rel="noopener noreferrer">on mainnet</a>.
It is a 0-amount asset transfer from the account to itself, asset 31566704, fee 0.001 ALGO.
Without it, nothing can pay you.</p>

<h3 id="connect">Connect it to your agent</h3>

<p>One command works for every agent.</p>

${code("bash", `npx roam402-mcp install`)}

<p>It finds Claude Code, Claude Desktop, Cursor and Codex on your machine and writes each one's
config in its own format. Claude Code goes through its CLI at user scope, Cursor and Desktop
get JSON, Codex gets TOML. Servers you already have are left alone, every file it touches is
backed up first, and running it again reports <em>already configured</em> rather than
duplicating anything. Add <code>--client cursor</code> to do just one.</p>

<p>Prefer to wire it yourself? Declining the prompt prints the JSON instead. Desktop reads
<code>~/Library/Application Support/Claude/claude_desktop_config.json</code> and Cursor reads
<code>.cursor/mcp.json</code>.</p>

${code(
  "claude_desktop_config.json",
  `{
  "mcpServers": {
    "roam402": {
      "command": "npx",
      "args": ["roam402-mcp"],
      "env": {
        "ROAM_MNEMONIC_FILE": "~/.roam402/mainnet.mnemonic",
        "ROAM_NETWORK": "mainnet"
      }
    }
  }
}`
)}

<p>Restart the app and the tools appear.</p>

<h3 id="tools">The seven tools</h3>

<div class="rx-table-wrap"><table class="rx-table">
<thead><tr><th>Tool</th><th>Cost</th><th>What it does</th></tr></thead>
<tbody>
<tr><td><code>roam_resolve</code></td><td>$0.0005</td><td>Plain English in, a ranked shortlist out. It never calls or pays.</td></tr>
<tr><td><code>roam_catalog</code></td><td>free</td><td>Browse or search everything callable, with filters for category, tier, method and price.</td></tr>
<tr><td><code>roam_schema</code></td><td>free</td><td>What inputs a route expects, read from the origin's payment challenge.</td></tr>
<tr><td><code>roam_call</code></td><td>per route</td><td>Calls the route. Pays the 402 and returns the body plus receipts.</td></tr>
<tr><td><code>roam_trust</code></td><td>$0.0005</td><td>Trust report for a seller domain. Tier, score, evidence pillars.</td></tr>
<tr><td><code>roam_precheck</code></td><td>$0.0002</td><td>Vets any x402 URL before you pay it, even one outside our catalog.</td></tr>
<tr><td><code>roam_optin</code></td><td>fees only</td><td>The opt-in above, from inside the agent.</td></tr>
</tbody>
</table></div>

<p>The natural flow is <code>roam_resolve</code>, then <code>roam_schema</code>, then
<code>roam_call</code>. Browsing and schemas are free, so an agent can explore the whole
catalog before spending a cent.</p>

<h3 id="conversation">What that looks like</h3>

<p>You never learn the tool names. You describe the job.</p>

${chat([
  { who: "user", text: "I need to turn some text into speech. What can I use, and what will it cost?" },
  {
    who: "tool",
    name: "roam_resolve",
    args: '{ intent: "convert text to speech", limit: 3 }',
    result: `SHORTLIST for "convert text to speech" (24 matched):
  1. xonaagent-audio-x-text-to-speech · $0.01 · xona-agent.com (Corroborated)
       X.AI text-to-speech: convert text to speech (MP3) (Base Mainnet).
  2. jarvisclaw-audio-speech · $0.001 · jarvisclaw.ai (Corroborated)
       AI text-to-speech - natural voice synthesis with multiple voices
  3. jarvisclaw-audio-transcriptions · $0.001 · jarvisclaw.ai (Corroborated)
       AI speech-to-text - Whisper-powered audio transcription`,
  },
  {
    who: "claude",
    text: "Three options. The cheapest text-to-speech is <b>jarvisclaw-audio-speech</b> at $0.001 a call, from a Corroborated seller. Let me check what it needs.",
  },
  {
    who: "tool",
    name: "roam_schema",
    args: '{ slug: "jarvisclaw-audio-speech" }',
    result: `POST /r/jarvisclaw-audio-speech  [source: origin-402]
BODY EXAMPLE:
{
  "model": "tts-1",
  "input": "Hello from roam402",
  "voice": "alloy"
}
NOTE: AI text-to-speech - natural voice synthesis with multiple
voices, pay per request with USDC`,
  },
  {
    who: "claude",
    text: "It takes <code>model</code>, <code>input</code> and <code>voice</code>. Shall I call it with your text at $0.001?",
  },
  { who: "user", text: "yes, go ahead" },
  {
    who: "tool",
    name: "roam_call",
    args: '{ slug: "jarvisclaw-audio-speech", json_body: { … } }',
    result: `200 OK · audio returned
paid $0.001 USDC on Algorand
receipts: algorand ✓  origin ✓`,
  },
])}

<p>Nothing was spent until the last step, and the agent asked first. Resolve cost $0.0005.
The schema was free. The call cost a tenth of a cent.</p>

<h2 id="sdk">The SDK</h2>

<p>Same gateway, no agent host. The client wraps <code>fetch</code>. A 402 response is
answered, signed and retried without you seeing it.</p>

${code(
  "bash",
  `npm i roam402
# algosdk is a peer dependency when you sign from a mnemonic
npm i algosdk`
)}

${code(
  "typescript",
  `import { createRoamClient, signerFromMnemonic } from "roam402";

const roam = createRoamClient({
  signer: await signerFromMnemonic(process.env.ROAM_MNEMONIC!),
  network: "mainnet",
});

// Say what you need. Returns candidates, buys nothing ($0.0005)
const { candidates } = await roam.resolve("transcribe an audio file", { limit: 3 });

// Learn what the best one expects. Free
const inputs = await roam.schema(candidates[0].path);

// Call it. The 402 is paid for you.
const res = await roam.call("jarvisclaw-audio-transcriptions", {
  body: { url: "https://example.com/clip.mp3" },
});
console.log(await res.json());`
)}

<p>Discovery needs no wallet. Leave the signer out and the free endpoints work the same. Paid
ones throw a clear <em>"no wallet is configured"</em> error.</p>

${code(
  "typescript",
  `const readOnly = createRoamClient({ network: "mainnet" });

// Paged, 25 routes per call, with total and next
const page = await readOnly.catalog({ q: "speech", maxPrice: 0.01, method: "POST" });
console.log(page.total, page.wrapped.length, page.next);

// Narrow instead of paging. The full table is ~1MB and will fill a context window
const cheap = await readOnly.catalog({ category: "ai_inference", tier: "Corroborated" });`
)}

<p>Vet an endpoint you found somewhere else before paying it.</p>

${code(
  "typescript",
  `const verdict = await roam.precheck("https://some-service.example/api/v1/thing");
const seller  = await roam.trust("blockrun.ai");`
)}

<h2 id="notes">Three things worth knowing</h2>

<p><strong>Your keys never leave the machine.</strong> The mnemonic signs locally. Only signed
payment payloads go over the wire, so Roam402 never sees it. Keep it in the <code>0600</code>
file the wizard writes and out of configs, repositories and chat windows.</p>

<p><strong>Nothing is charged when the origin fails.</strong> Payment settles after the
upstream service answers. A broken endpoint costs you nothing. If a route is down, the gateway
refuses before payment.</p>

<p><strong>Start small.</strong> Median price across the catalog is about a cent. The wallet
in this post held 0.3 ALGO and 0.1 USDC, enough for hundreds of calls.</p>

<p class="rx-outro">Browse what is callable in the <a href="/marketplace">marketplace</a>, try a
route without installing anything in the <a href="/playground">playground</a>, or read the
machine-readable spec at <a href="/llms.txt">/llms.txt</a>.</p>
`,
};

const POSTS: Post[] = [GETTING_STARTED];

/* ── Pages ───────────────────────────────────────────────────────────────── */

const PROSE_CSS = `<style>
.rx-post{max-width:46rem;margin:0 auto}
.rx-post h2{font-size:26px;font-weight:600;color:#1c1f2e;margin:44px 0 14px;letter-spacing:-.01em}
.rx-post h3{font-size:19px;font-weight:600;color:#26293b;margin:32px 0 10px}
.rx-post p{font-size:16px;line-height:1.75;color:#3b3f52;margin:14px 0}
.rx-post p.rx-lede{font-size:18px;line-height:1.7;color:#26293b}
.rx-post p.rx-outro{margin-top:34px;padding-top:20px;border-top:1px solid hsl(var(--border));color:#6b7089}
.rx-post a{color:#4f46e5;text-decoration:underline;text-underline-offset:2px}
.rx-post code{font-family:var(--font-mono);font-size:13.5px;background:#eceefa;color:#3730a3;padding:1px 5px;border-radius:5px}
.rx-post strong{color:#1c1f2e;font-weight:600}
.rx-callout{margin:22px 0;padding:16px 18px;border:1px solid #fcd34d;border-left-width:3px;background:#fffbeb;border-radius:10px}
.rx-callout p{margin:0;font-size:15px;color:#78350f}
.rx-term{margin:26px 0;background:linear-gradient(180deg,#181b2e 0%,#0d0f1c 60%);border:1px solid rgba(129,140,248,.18);border-radius:16px;overflow:hidden;box-shadow:0 22px 48px -20px rgba(23,26,63,.55),0 4px 14px rgba(23,26,63,.16),inset 0 1px 0 rgba(255,255,255,.06)}
.rx-term-bar{display:flex;align-items:center;gap:7px;padding:11px 15px;background:rgba(255,255,255,.035);border-bottom:1px solid rgba(129,140,248,.12)}
.rx-term-dot{flex:0 0 auto;width:11px;height:11px;border-radius:9999px;box-shadow:inset 0 -1px 1px rgba(0,0,0,.25),inset 0 1px 1px rgba(255,255,255,.35)}
.rx-dot-r{background:#ff5f57}
.rx-dot-y{background:#febc2e}
.rx-dot-g{background:#28c840}
.rx-term-title{flex:1;text-align:center;padding-right:43px;font-family:var(--font-mono);font-size:11px;letter-spacing:.05em;color:#7d829e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rx-term-body{padding:16px 18px 18px;overflow-x:auto;font-family:var(--font-mono);font-size:12.5px;line-height:1.85}
.rx-term-cmd{color:#f4f4f6;font-weight:500;white-space:pre}
.rx-term-cmd span{color:#a5b4fc;user-select:none;margin-right:9px;font-weight:700}
.rx-term-out{color:#9297b3;white-space:pre}
.rx-term-out+.rx-term-cmd,.rx-term-note+.rx-term-cmd{margin-top:10px}
.rx-term-out b{color:#e8e9f2;font-weight:600}
.rx-term-out .g{color:#34d399}
.rx-term-out .w{color:#fbbf24}
.rx-term-note{color:#6a6f8e;font-style:italic;margin:12px 0 3px;white-space:pre-wrap}
.rx-code-block{position:relative;margin:20px 0;background:#0d0f1c;border:1px solid rgba(129,140,248,.18);border-radius:14px;overflow:hidden;box-shadow:0 10px 28px -16px rgba(23,26,63,.4)}
.rx-code-lang{position:absolute;top:0;right:0;padding:5px 12px;font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#7d829e;background:#161a30;border-bottom-left-radius:10px}
.rx-code-block pre{margin:0;padding:18px;overflow-x:auto}
.rx-code-block code{font-family:var(--font-mono);font-size:12.5px;line-height:1.7;color:#d4d4d8;background:none;padding:0}
.rx-chat{margin:22px 0;border:1px solid hsl(var(--border));border-radius:16px;background:#fff;overflow:hidden;box-shadow:0 1px 2px rgba(13,14,21,.04)}
.rx-chat-bar{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid hsl(var(--border));background:#fafaff;font-size:12px;font-weight:600;color:#6b7089}
.rx-chat-dot{width:8px;height:8px;border-radius:9999px;background:#d97757}
.rx-msg{display:flex;gap:11px;padding:15px 16px}
.rx-msg-user{background:#f8f9fd}
.rx-avatar{flex:0 0 auto;width:25px;height:25px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700}
.rx-avatar-you{background:#e5e7f5;color:#4f46e5}
.rx-avatar-ai{background:#d97757;color:#fff;font-size:13px}
.rx-bubble{font-size:14.5px;line-height:1.65;color:#26293b;padding-top:3px}
.rx-bubble-ai{color:#3b3f52}
.rx-bubble code{font-size:12.5px}
.rx-tool{margin:0 16px 14px 52px;border:1px solid #e3e5f0;border-radius:11px;overflow:hidden;background:#fbfbfe}
.rx-tool-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid #eceefa;font-family:var(--font-mono);font-size:11px}
.rx-tool-name{color:#4f46e5;font-weight:600}
.rx-tool-args{color:#9aa0b6;overflow:hidden;text-overflow:ellipsis}
.rx-tool-out{margin:0;padding:11px 12px;font-family:var(--font-mono);font-size:11.5px;line-height:1.65;color:#4b5066;white-space:pre-wrap;overflow-x:auto}
.rx-table-wrap{overflow-x:auto;margin:20px 0}
.rx-table{width:100%;border-collapse:collapse;font-size:14px}
.rx-table th{text-align:left;padding:9px 12px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7089;border-bottom:1px solid hsl(var(--border))}
.rx-table td{padding:10px 12px;border-bottom:1px solid rgba(13,14,21,.06);color:#3b3f52;vertical-align:top}
.rx-table td:first-child{white-space:nowrap}
.rx-post-meta{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-family:var(--font-mono);font-size:12px;color:#8a8fa6;margin-top:10px}
a.rx-post-card{display:block;padding:22px 24px;border:1px solid hsl(var(--border));border-radius:16px;background:#fff;box-shadow:0 1px 2px rgba(13,14,21,.04);transition:border-color .2s,transform .2s,box-shadow .2s;text-decoration:none}
.rx-post-card:hover{border-color:#a5b4fc;transform:translateY(-2px);box-shadow:0 8px 24px rgba(79,70,229,.08)}
.rx-post-card h2{font-size:21px;font-weight:600;color:#1c1f2e;margin:0}
.rx-note-inline{font-size:14.5px;color:#3b3f52;border-left:3px solid #a5b4fc;padding-left:14px;margin:20px 0}
.rx-post-card p{font-size:14.5px;color:#6b7089;margin:8px 0 0;line-height:1.6}
</style>`;

function indexPage(cfg: Config): string {
  const cards = POSTS.map(
    (p) => `<a class="rx-post-card" href="/blog/${p.slug}">
      <h2>${p.title}</h2>
      <p>${p.summary}</p>
      <div class="rx-post-meta">
        <span>${fmtDate(p.date)}</span><span>·</span><span>${p.readingMinutes} min read</span>
      </div>
    </a>`
  ).join("\n");

  return shell({
    title: "Blog | Roam402",
    description: "How to use Roam402 — the MCP server, the SDK, and the x402 economy on Algorand.",
    path: "/blog",
    baseUrl: cfg.publicBaseUrl,
    active: "blog",
    head: PROSE_CSS,
    body: `<main class="mx-auto w-full z-40 relative">
  <div class="w-full mx-auto lg:max-w-screen-xl lg:mx-auto px-4 md:px-12 pt-12 pb-20">
    <div class="rx-post">
      <div class="rx-eyebrow">BLOG</div>
      <h1 class="text-3xl md:text-4xl font-bold !leading-tight mt-2">Notes from the gateway</h1>
      <p class="text-base text-muted-foreground mt-3">Using Roam402, and what we learn running it.</p>
      <div class="mt-8 flex flex-col gap-4">${cards}</div>
    </div>
  </div>
</main>`,
  });
}

function postPage(cfg: Config, post: Post): string {
  return shell({
    title: `${post.title} | Roam402`,
    description: post.summary,
    path: `/blog/${post.slug}`,
    baseUrl: cfg.publicBaseUrl,
    active: "blog",
    head: PROSE_CSS,
    body: `<main class="mx-auto w-full z-40 relative">
  <div class="w-full mx-auto lg:max-w-screen-xl lg:mx-auto px-4 md:px-12 pt-12 pb-20">
    <article class="rx-post">
      <h1 class="text-3xl md:text-4xl font-bold !leading-tight">${post.title}</h1>
      <div class="rx-post-meta">
        <span>${fmtDate(post.date)}</span><span>·</span><span>${post.readingMinutes} min read</span>
      </div>
      ${post.body}
    </article>
  </div>
</main>`,
  });
}

export function mountBlog(app: Hono<AppEnv>, cfg: Config): void {
  app.get("/blog", (c) => c.html(indexPage(cfg), 200, { "cache-control": "public, max-age=600" }));
  app.get("/blog/:slug", (c) => {
    const post = POSTS.find((p) => p.slug === c.req.param("slug"));
    if (!post) return c.redirect("/blog", 302);
    return c.html(postPage(cfg, post), 200, { "cache-control": "public, max-age=600" });
  });
}
