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
import { icon } from "../lib/icons";

interface Post {
  slug: string;
  title: string;
  /** One line for the index card and the meta description. */
  summary: string;
  /** ISO date; rendered as "17 August 2026". */
  date: string;
  readingMinutes: number;
  tags: string[];
  body: string;
}

/** Package versions this post was written against — bump with a release. */
const VERSIONS = { mcp: "0.2.1", sdk: "0.2.1" };

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** Terminal transcript. `out` lines are muted, `$` lines are the command. */
const term = (lines: [kind: "cmd" | "out" | "note", text: string][]): string =>
  `<div class="rx-term">${lines
    .map(([k, t]) =>
      k === "cmd"
        ? `<div class="rx-term-cmd"><span>$</span> ${t}</div>`
        : k === "note"
          ? `<div class="rx-term-note">${t}</div>`
          : `<div class="rx-term-out">${t}</div>`
    )
    .join("")}</div>`;

const code = (lang: string, src: string): string =>
  `<div class="rx-code-block"><div class="rx-code-lang">${lang}</div><pre><code>${src}</code></pre></div>`;

/* ── Posts ────────────────────────────────────────────────────────────────── */

const GETTING_STARTED: Post = {
  slug: "give-your-agent-a-wallet",
  title: "Give your agent a wallet",
  summary:
    "From nothing to a paid API call in about five minutes — the roam402 MCP server, the SDK, and the one Algorand detail that trips everybody up.",
  date: "2026-08-17",
  readingMinutes: 7,
  tags: ["mcp", "sdk", "algorand", "x402"],
  body: `
<p class="rx-lede">Roam402 is a roaming gateway for the x402 economy. Your agent pays once, in
USDC on Algorand, and calls any of ${"2,349"} verified services that live on other chains —
Base, Solana, Ethereum — getting a receipt from both chains with every response.</p>

<p>There are two ways in. The <strong>MCP server</strong> gives any agent host (Claude Code,
Claude Desktop, Cursor) seven tools and no code. The <strong>SDK</strong> is four lines of
TypeScript for when you are building something yourself. This post walks through both, using a
real wallet on mainnet — every address and transaction below is genuine.</p>

<p class="rx-versions">Written against
<a href="https://www.npmjs.com/package/roam402-mcp" target="_blank" rel="noopener noreferrer"><code>roam402-mcp@${VERSIONS.mcp}</code></a> and
<a href="https://www.npmjs.com/package/roam402" target="_blank" rel="noopener noreferrer"><code>roam402@${VERSIONS.sdk}</code></a>,
both published on npm — <code>npx</code> and <code>npm i</code> pick them up with no version pin needed.</p>

<h2 id="mcp">Part one: the MCP server</h2>

<p>You need an Algorand wallet that holds a little USDC. If you do not have one, the setup
wizard makes one — no wallet app, no browser extension, nothing to sign up for.</p>

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

<p>The key is written to a file with <code>0600</code> permissions rather than printed, because
25 words in your terminal scrollback end up in screenshots and pasted into chats. The config
you give your agent host holds a <em>path</em>, not a secret:</p>

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

<h3 id="funding">Funding it, in the order Algorand actually requires</h3>

<div class="rx-callout">
  <p><strong>This is the part that trips everybody up.</strong> An Algorand account
  <em>cannot receive</em> an asset it has not opted into. The opt-in is a transaction the
  account signs <em>itself</em>, so it needs ALGO before it can accept USDC. Send USDC first
  and the transfer simply fails.</p>
</div>

<p>So the order is: ALGO, then opt in, then USDC.</p>

${term([
  ["note", "1. Send ~0.3 ALGO to the address — from any exchange, no wallet app needed."],
  ["cmd", "npx roam402-mcp --status"],
  ["out", "address   3GE37VSG37CVDA3MZGLOP4TKO7OXFDZLXSPO6CK2KK343C4HV6REUDOJOM"],
  ["out", "network   mainnet"],
  ["out", "ALGO      0.2"],
  ["out", "USDC      not opted in — run: npx roam402-mcp --optin"],
  ["note", "2. Opt in. 0.2 ALGO is not quite enough, and it says exactly why:"],
  ["cmd", "npx roam402-mcp --optin"],
  ["out", "Not enough ALGO to opt in: this wallet holds 0.2 ALGO and needs ~0.21"],
  ["out", "(0.1 minimum balance + 0.1 more to hold an asset + fees)."],
  ["note", "…top it up, then:"],
  ["cmd", "npx roam402-mcp --optin"],
  ["out", "<span class='g'>Opted in to USDC (asset 31566704) on mainnet.</span>"],
  ["out", "Transaction KOLPQ75YMEFJGNTOUR7MN6NYCOXEX6LR2LKRL2HGQVPRLXSIGATA"],
  ["note", "3. Now send USDC."],
  ["cmd", "npx roam402-mcp --status"],
  ["out", "ALGO      0.299"],
  ["out", "USDC      0.1"],
])}

<p class="rx-note-inline">The <code>--optin</code> and <code>--status</code> commands landed in
<code>roam402-mcp@0.2.1</code>. On an older copy they will not be recognised — <code>npx</code>
fetches the current release, or run <code>npx roam402-mcp@latest --optin</code> to be sure.</p>

<p>That opt-in is <a href="https://allo.info/tx/KOLPQ75YMEFJGNTOUR7MN6NYCOXEX6LR2LKRL2HGQVPRLXSIGATA" target="_blank" rel="noopener noreferrer">on mainnet</a>:
a 0-amount asset transfer from the account to itself, asset 31566704, fee 0.001 ALGO. That is
all an opt-in is — but without it, nothing can pay you.</p>

<h3 id="tools">The seven tools</h3>

<p>Restart your agent host and ask it <em>"what can I buy through roam402?"</em>. It gets:</p>

<div class="rx-table-wrap"><table class="rx-table">
<thead><tr><th>Tool</th><th>Cost</th><th>What it does</th></tr></thead>
<tbody>
<tr><td><code>roam_resolve</code></td><td>$0.0005</td><td>Plain English in, a ranked shortlist of routes out. It suggests — it never calls or pays for them.</td></tr>
<tr><td><code>roam_catalog</code></td><td>free</td><td>Browse or search everything callable. Paged, with filters for category, tier, method and price.</td></tr>
<tr><td><code>roam_schema</code></td><td>free</td><td>What inputs a route expects, read from the origin's own payment challenge.</td></tr>
<tr><td><code>roam_call</code></td><td>per route</td><td>Actually call it. Pays the 402 and returns the body plus receipts.</td></tr>
<tr><td><code>roam_trust</code></td><td>$0.0005</td><td>Trust report for a seller domain: tier, score, evidence pillars.</td></tr>
<tr><td><code>roam_precheck</code></td><td>$0.0002</td><td>Vet any x402 URL before paying it, even one not in our catalog.</td></tr>
<tr><td><code>roam_optin</code></td><td>fees only</td><td>The opt-in above, from inside the agent.</td></tr>
</tbody>
</table></div>

<p>The natural flow is <code>roam_resolve</code> → <code>roam_schema</code> →
<code>roam_call</code>: say what you need, learn what the winner expects, call it. Browsing and
reading schemas cost nothing, so an agent can explore the whole catalog before spending a cent.</p>

<h2 id="sdk">Part two: the SDK</h2>

<p>Same gateway, no agent host. The client wraps <code>fetch</code> so a 402 response is
answered, signed and retried without you seeing it.</p>

${code(
  "bash",
  `npm i roam402          # ${VERSIONS.sdk}
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

// Say what you need — returns candidates, buys nothing ($0.0005)
const { candidates } = await roam.resolve("transcribe an audio file", { limit: 3 });

// Learn what the best one expects — free
const inputs = await roam.schema(candidates[0].path);

// Call it. The 402 is paid for you.
const res = await roam.call("jarvisclaw-audio-transcriptions", {
  body: { url: "https://example.com/clip.mp3" },
});
console.log(await res.json());`
)}

<p>Discovery does not need a wallet at all. Leave the signer out and the free endpoints work
exactly the same, while paid ones throw a clear <em>"no wallet is configured"</em> instead of
failing somewhere deep in the payment layer:</p>

${code(
  "typescript",
  `const readOnly = createRoamClient({ network: "mainnet" });

// Paged: 25 routes per call, with total and next
const page = await readOnly.catalog({ q: "speech", maxPrice: 0.01, method: "POST" });
console.log(page.total, page.wrapped.length, page.next);

// Narrow instead of paging — the whole table is ~1MB and will fill a context window
const cheap = await readOnly.catalog({ category: "ai_inference", tier: "Corroborated" });`
)}

<p>And before paying an endpoint you found somewhere else entirely:</p>

${code(
  "typescript",
  `const verdict = await roam.precheck("https://some-service.example/api/v1/thing");
const seller  = await roam.trust("blockrun.ai");`
)}

<h2 id="notes">Three things worth knowing</h2>

<p><strong>Your keys never leave the machine.</strong> The mnemonic is read locally, signs
locally, and only signed payment payloads go over the wire. Roam402 never sees it. Keep it in
the <code>0600</code> file the wizard writes and out of your agent host's config, out of
repositories, and out of chat windows.</p>

<p><strong>Nothing is charged when the origin fails.</strong> Payment is settled after the
upstream service answers, so a broken endpoint costs you nothing. If a route is down, the
gateway refuses before payment rather than taking your money and apologising.</p>

<p><strong>Start small.</strong> Median price across the catalog is about a cent, and the
trust endpoints cost a fraction of that. The wallet in this post was funded with 0.3 ALGO and
0.1 USDC — enough for hundreds of calls.</p>

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
.rx-term{margin:20px 0;background:#0d0e15;border:1px solid #23263a;border-radius:14px;padding:16px 18px;overflow-x:auto;font-family:var(--font-mono);font-size:12.5px;line-height:1.75}
.rx-term-cmd{color:#e4e4e7;white-space:pre}
.rx-term-cmd span{color:#6366f1;user-select:none;margin-right:6px}
.rx-term-out{color:#a1a1aa;white-space:pre}
.rx-term-out b{color:#e4e4e7;font-weight:600}
.rx-term-out .g{color:#4ade80}
.rx-term-out .w{color:#fbbf24}
.rx-term-note{color:#71717a;font-style:italic;margin:10px 0 2px;white-space:pre-wrap}
.rx-code-block{position:relative;margin:20px 0;background:#0d0e15;border:1px solid #23263a;border-radius:14px;overflow:hidden}
.rx-code-lang{position:absolute;top:0;right:0;padding:5px 12px;font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#71717a;background:#15161f;border-bottom-left-radius:10px}
.rx-code-block pre{margin:0;padding:18px;overflow-x:auto}
.rx-code-block code{font-family:var(--font-mono);font-size:12.5px;line-height:1.7;color:#d4d4d8;background:none;padding:0}
.rx-table-wrap{overflow-x:auto;margin:20px 0}
.rx-table{width:100%;border-collapse:collapse;font-size:14px}
.rx-table th{text-align:left;padding:9px 12px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7089;border-bottom:1px solid hsl(var(--border))}
.rx-table td{padding:10px 12px;border-bottom:1px solid rgba(13,14,21,.06);color:#3b3f52;vertical-align:top}
.rx-table td:first-child{white-space:nowrap}
.rx-post-meta{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-family:var(--font-mono);font-size:12px;color:#8a8fa6;margin-top:10px}
.rx-tag{display:inline-flex;align-items:center;border:1px solid hsl(var(--border));background:#fff;border-radius:9999px;padding:2px 9px;font-size:10.5px;color:#6b7089}
.rx-post-card{display:block;padding:22px 24px;border:1px solid hsl(var(--border));border-radius:16px;background:#fff;box-shadow:0 1px 2px rgba(13,14,21,.04);transition:border-color .2s,transform .2s,box-shadow .2s}
.rx-post-card:hover{border-color:#a5b4fc;transform:translateY(-2px);box-shadow:0 8px 24px rgba(79,70,229,.08)}
.rx-post-card h2{font-size:21px;font-weight:600;color:#1c1f2e;margin:0}
.rx-versions{font-size:14px;color:#6b7089;padding:12px 16px;background:#f4f5fb;border:1px solid hsl(var(--border));border-radius:10px}
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
        ${p.tags.map((t) => `<span class="rx-tag">${t}</span>`).join("")}
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
      <a class="text-xs font-mono uppercase tracking-widest text-slate-500 hover:text-slate-700" href="/blog">${icon("arrow-right", 10)} back to blog</a>
      <h1 class="text-3xl md:text-4xl font-bold !leading-tight mt-4">${post.title}</h1>
      <div class="rx-post-meta">
        <span>${fmtDate(post.date)}</span><span>·</span><span>${post.readingMinutes} min read</span>
        ${post.tags.map((t) => `<span class="rx-tag">${t}</span>`).join("")}
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
