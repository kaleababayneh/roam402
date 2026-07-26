# hackathon.md — challenge compliance, Bazaar listing plan, submission draft, and the moves that win

*Re-read of the official "How to build & submit" checklist (2026-07-21),
mapped line-by-line onto Roam402. This is the competition playbook; the
engineering status lives in SUMMARY.md.*

---

## 1. The official finish line, mapped to us

The Foundation defines "competition-ready" as five checkboxes:

| Official requirement | Our status |
|---|---|
| ≥1 real **Mainnet** payment settled through GoPlausible | ⬜ blocked on P1 wallets/domain — flow proven on testnet (their step 2, done exactly as prescribed: same facilitator, ASA 10458941, opted-in payTo, full 402→pay→settle→response loop) |
| Paid response returned | ✅ proven (testnet, incl. via MCP tool call) |
| USDC lands in payTo | ✅ proven on testnet ledger; mainnet pending |
| Endpoint appears in **Bazaar under `x402-global-challenge` tag** | ⬜ auto after first mainnet settlement — tag already verified present in our live 402 challenges (`accepts.extra.tag`), exactly per their screenshot |
| Driving real usage visible on leaderboard | ⬜ the October game — §5 |

Verification ritual once mainnet-live: facilitator Bazaar with **global
hackathon filter ON** → our merchant row (keyed by payTo) + per-route
resource entries; check "completeness of your data records there" (their
words) — that's the metadata enrichment below.

## 2. Entry classification (and the rule we must never break)

We are **one merchant = Composite + Orchestrator hybrid**, both shapes
explicitly defined by the rules:

- **Composite**: ~52 routes (wrapped + native), every one sharing the ONE
  payTo → the facilitator auto-rolls them into a single merchant row.
  "There's no separate registration step" — it's just how settlement works.
- **Orchestrator**: our backend pays downstream to fulfil. The rules'
  words: *"Settle the client's payment first… Pay downstream from your
  wallet… both sides of a real transaction are real activity."* We settle
  inbound before any downstream spend — our guard→verify→fulfil→settle
  order satisfies this by construction.

**Hard rules extracted (violations = disqualification territory):**
1. ONE payTo for the whole competition (leaderboard identity). Never a second.
2. One root domain per merchant; "use endpoints to differentiate resources,
   not different domains." All 52 routes are paths under one domain. ✅ design.
3. Public HTTPS host, not localhost. (Workers custom domain at deploy.)
4. GoPlausible facilitator only — no local/other facilitator. ✅ wired.
5. Testnet is validation only; leaderboard is mainnet.

### The dual-counting rule — our biggest under-exploited mechanic

The checklist states it **twice**: an orchestrator's downstream payments
*"count toward your own leaderboard total as well, since both sides of a
real transaction are real activity."*

Today our downstream spends go to **Base** (invisible to the Algorand
leaderboard). But any downstream spend to an **Algorand-native endpoint —
i.e. other challenge entrants — counts for US and for THEM.** One client
dollar can produce more than one dollar of our leaderboard credit, by the
organizers' own written rule. §5.1 builds on this. (Mild tension exists
between the two phrasings in the post — one section says "tracked the same
as any Standard Entry" — so we confirm the dual-count reading on Discord
before we bet the strategy on it; the products below are worth building
under either reading.)

## 3. What we list in the Bazaar (the listing plan)

The checklist is explicit: the route `description` is what humans AND
agents see; *"name what the caller actually gets, not just the topic"*;
attach a **declared discovery extension to each route**; the merchant page
is enriched from **domain metadata, logo, agentic files, well-known
structures, and NFD**.

We do NOT dump 52 undifferentiated routes — the 466-listing merchant with
$21 settled is the cautionary tale. **Five curated doors in the Bazaar; the
full catalog behind door #1.** Listing few costs zero leaderboard credit
(rollup is by payTo, not by Bazaar visibility).

**The five listed doors:**

| Listed endpoint | Role | Bazaar copy |
|---|---|---|
| `GET /catalog` (listed as a resource itself) | **The master key** | "Machine-readable catalog of 50+ verified x402 services callable through this merchant — LLM inference, token security, market data — each with USDC price, trust tier and liveness. Free." |
| `GET /trust?domain=` | Sole-provider native | "Trust report for any x402 seller: Agents-Trust tier, 0–100 score, verified on-chain volume from $45M+ of indexed settlement." |
| `GET /precheck?url=` | Sole-provider native | "Pre-flight safety check before your agent pays an unknown x402 endpoint: known-seller match, tier, liveness, price sanity. $0.0002 insurance." |
| `POST /bundle/token-diligence` | Our composed product | "One call, full token due-diligence: QuickIntel security scan + market context + Agents-Trust verification, one JSON verdict, per-source receipts." |
| `GET /r/quickintel-scan-full` | Category-proof wrap | "Full token security scan (honeypot, taxes, LP locks, contract risk) by QuickIntel — via Roam402, payable in USDC on Algorand." |

*(Positioning per Kaleab: vendor of others' services + sole provider only
of trust. The OpenAI-compatible `/v1/chat/completions` alias is PARKED —
note it needs no API keys from us either way; it's the same x402-paid wrap.)*

**How agents discover the other 45 (→95+):**
1. `/catalog` free JSON — SDK + MCP read it live (`roam_catalog`), so every
   integration auto-reflects catalog growth with no republishing.
2. **Every 402 advertises the index** — build item: add
   `catalog: "https://roam402.com/catalog"` to `extra` on every challenge, so
   touching ANY route hands the agent the full map inside the protocol
   response (and the Bazaar records inherit it).
3. `/llms.txt` + `/.well-known/agents.json` (agentic crawler surfaces).
4. SDK/MCP distribution — discovery as a function call, not browsing.

**Scaling 50 → 100+:** the catalog is generated, not written. Census
supply: 2,811 wrappable endpoints (2,469 live-probed). Growth = raise the
generator knobs (MAX_ROUTES / MAX_PER_SERVICE / price cap / volume
threshold), review the committed JSON diff, redeploy — zero marginal code
per route; guards, receipts, health, tag all inherited. Cadence: weekly
regeneration (prices track origins; dead endpoints fall out via the health
sweep). Wave 2 mid-Aug → ~100; wave 3 Sept → entrant wraps
(Algorand-native) + Solana fulfilment if demand justifies a second
treasury. Real scaling constraint = Base float; wallet-balance alerting
becomes mandatory at wave 2.

**Merchant-page enrichment checklist** (the "shiny, data-enriched" note):
- ✅ landing with metadata/OG, `/llms.txt`, `/.well-known/agents.json`
- ⬜ NFD registered to the payTo (do at wallet creation — it's how the
  Bazaar names the merchant)
- ⬜ logo asset + favicon on the domain
- ⬜ re-verify every record in the Bazaar after first settlement

## 4. Submission draft (September form — write once, paste later)

**Project**: Roam402 — the x402 roaming gateway, by Agents-Trust
**One-liner**: Every verified x402 service — LLM inference, token security,
market data — payable in USDC on Algorand through one merchant, fulfilled
cross-chain with cryptographically signed dual-chain receipts.

**What the payment unlocks**: 50+ liveness-probed, trust-tiered API
capabilities (from $0.0001/call LLM completions to $0.24 deep token
scans), plus native trust endpoints and composed diligence bundles.
Discovery is free (`/catalog`); every paid response carries an EdDSA-signed
receipt (did:jwk — verifiable offline by anyone) binding payer, resource,
and both settlement legs.

**Proof of who is paying**: public, continuous, cryptographic —
`/receipts` streams every settlement (no PII) with origin-chain
references; signed receipts make each one independently verifiable; zero
self-generated volume by policy. Buyers arrive via the `roam402` SDK,
the `roam402-mcp` server (any Claude/Cursor/MCP agent = one config block),
the browser playground (Pera), and the OpenAI-compatible baseURL.

**Why it matters to Algorand (long-term)**: solves the cold-start —
Algorand instantly has the largest x402 catalog of any chain, and the
gateway's treasury makes Algorand agents first-class buyers of the whole
x402 economy. Built by Agents-Trust, whose public observatory
(agents-trust.com) indexes $45M+ of x402 settlement and now hosts the
challenge's live scoreboard — we are infrastructure for the ecosystem, not
just an entry in it.

**Technical highlights (execution criterion)**: verify→fulfil→settle
ordering (a buyer is never charged for a failed upstream call, proven with
a kill-switch drill on real payments); self-healing catalog (unpaid 402
probes as liveness oracle); signed offers + receipts via the x402
offer-receipt extension; MCP-native; open stats API.

**Links**: landing · /playground · /catalog · /receipts ·
agents-trust.com/algorand (scoreboard) · npm: roam402, roam402-mcp ·
GitHub (if we open-source — recommended before submission; judges reward
inspectable execution).

## 5. Creative moves to win (brainstorm, ranked by leverage)

### 5.1 Leaderboard-native mechanics

- **Bundles (composed endpoints)** — `/bundle/token-diligence`,
  `/bundle/market-brief`: one client call fans out to multiple paid
  sources and returns a synthesized verdict with per-source receipts.
  Product value alone justifies it (agents want verdicts, not five raw
  calls). Under the dual-count rule, every bundle sub-payment to an
  **Algorand-native** source ALSO credits our total: client pays $0.10 →
  we spend $0.06 downstream on entrants → up to $0.16 credited to us, by
  the rules as written.
- **Wrap the entrants** — add the *other challenge teams'* Algorand
  endpoints to our catalog (syraa market data, algometrics, netintel…),
  with trust tiers + receipts on top. Both payment legs live on Algorand;
  they gain volume and become our promoters. Roam stops being "Base
  imported to Algorand" and becomes **the router of the whole challenge**.
- **Be everyone's client**: our MCP/SDK exposes not just our routes but
  (via /catalog growth) every worthwhile Algorand endpoint — the more
  agent traffic flows through our wallet, the more of the challenge's
  total activity has us on one side of the transaction.

### 5.2 Usage engines (real third parties, compounding)

- **OpenAI-compatible baseURL** (highest-leverage single feature left):
  alias `POST /v1/chat/completions` → blockrun wrap. Any existing agent
  framework switches with ONE line (`baseURL: "https://roam402.com/v1"`).
  Pay-per-call LLM on Algorand, no account, at $0.0001 — the tx-count
  engine for the leaderboard and the easiest thing to market we own.
- **2-minute starter kit**: `npx roam402-start` → generates a wallet,
  prints faucet/opt-in steps and a funded first call. Friction is the
  enemy; the Foundation's own docs prove readers follow checklists.
- **Ship an Algorand "agent skill"**: the blog tells every builder to
  install agent skills — publish a `roam402` skill/plugin into that
  toolchain so builders following the Foundation's own instructions find
  us pre-integrated.
- **Builder credits, disclosed**: seed $150–300 of USDC as credits to devs
  who build on roam402 (their wallets, their projects, their calls). It's
  the cloud-credits playbook — real third-party usage, transparently
  funded; disclose the program on /receipts. (Their money → their wallet
  → our endpoint = real activity; we never touch their keys.)
- **Public demo agent with receipts**: a visible bot (TG/Discord) doing
  token-diligence bundles on request, posting the signed receipt +
  explorer links each time — a living ad; clearly labeled ours and
  excluded from any usage claims.
- **Origin-seller co-marketing**: blockrun/quickintel tweet "our API is
  now on Algorand" to their existing users — distribution we don't pay for.

### 5.3 Judge/spectacle moves (finalist stage)

- **The 90-second live demo**: Claude on stage with roam402-mcp — check
  balance → precheck an endpoint → run a token-diligence bundle → cash
  receipt appears on /receipts → **verify its signature live** against the
  did:jwk. All real mainnet money, no slides.
- **"Verifiable expense reports for agents"**: export a session's signed
  receipts as an audit bundle — the enterprise story (CFO-provable agent
  spending) that answers "long-term potential" beyond the hackathon.
- **The flywheel slide**: census → catalog → gateway → receipts →
  observatory (agents-trust.com/algorand) → census. Nobody else can draw
  that loop; it's why we exist after November.

### 5.4 Build queue implied by this document

1. OpenAI-compatible alias route (small; big).
2. `/bundle/token-diligence` v1 (fan-out module + synthesis; start with
   our Base wraps + native trust, add Algorand-native sources after the
   Discord dual-count confirmation).
3. Algorand-native downstream support in `fulfillment/` (AVM client from
   the operating wallet — mirrors the existing Base module).
4. Wrap 3–5 entrant endpoints (with their blessing via the outreach DMs).
5. Tier-A/B listing-copy audit + discovery schemas on top-10 wraps.
6. NFD + logo at wallet creation; open-source decision before submission.
7. Discord Q: confirm dual-count phrasing.
