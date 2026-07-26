# Roam402 — project summary & onboarding

*Written 2026-07-26 for the team. Read time ~10 min; after it you should be
able to run, test, and extend everything. Deeper docs: `docs/PLAN.md`
(strategy + phase status), `docs/RUNBOOK.md` (operations, mainnet cutover),
`docs/OUTREACH.md` (demand playbook).*

---

## 1. What this is

**Roam402 is our entry to the Algorand Global x402 Challenge** ($100K USD +
500K ALGO; top-50 leaderboard → 10 finalists present at Devcon 8 India in
early November). It is an **x402 roaming gateway**: agents on Algorand pay
USDC (via the GoPlausible facilitator — the challenge's mandatory rail) to
call any of ~50 verified x402 services that actually live on Base. We
fulfil each call cross-chain from our own treasury and return the response
with receipts from **both** chains. Built by Agents-Trust — the gateway's
catalog, trust tiers, and liveness data all come from our census of $45M+
of real x402 settlement.

Repo layout (pnpm workspace):

```
roam402/
├── src/                  Cloudflare Worker — the gateway itself
│   ├── index.ts          assembly only (error boundary → free → guard → x402 → handlers)
│   ├── config.ts         ALL chain constants + env (testnet⇄mainnet = one var)
│   ├── catalog.ts        typed access to catalog/routes.json (generated)
│   ├── pricing.ts        margin model: origin × 1.2 + $0.0005, rounded up
│   ├── payment/          server-side x402 (ONLY file group touching @x402 server APIs)
│   │   ├── server.ts     resource server, AVM scheme, Bazaar ext, challenge tag
│   │   ├── signedReceipts.ts  EdDSA JWS offers/receipts, did:jwk kid
│   │   └── receipts.ts   dual-chain receipt headers
│   ├── fulfillment/      client-side x402 (Base) + safety
│   │   ├── origin.ts     pay-and-fetch origins (ONLY x402-client file)
│   │   ├── wallet.ts     Base hot wallet custody boundary
│   │   ├── breaker.ts    in-memory circuit breaker
│   │   └── health.ts     cron sweep: unpaid probe (402 = alive), KV verdicts
│   ├── receipts/store.ts KV proof-of-payers log (no PII)
│   └── routes/           wrapped.ts (guards+proxy) · native.ts (/trust /precheck)
│                         free.ts (/healthz /catalog) · landing.ts · playground.ts
│                         receipts.ts (/receipts page) · stats.ts (/api/challenge-stats)
├── catalog/routes.json   GENERATED route table (committed, reviewable diffs)
├── scripts/              generate-catalog · smoke-client · verify-receipt ·
│                         new-account · optin · new-receipt-key · debug-402
├── sdk/                  npm package `roam402` — createRoamClient()
├── mcp/                  npm package `roam402-mcp` — 5 MCP tools over stdio
├── examples/agent-call.ts
└── .secrets/             testnet keys (gitignored): testnet-buyer.json / testnet-merchant.json
```

Related, in the **agentscan** repo: branch **`algorand`** carries the public
challenge scoreboard page (`/algorand/` — live merchant leaderboard from the
facilitator's discovery API). Kept off `ch` so it doesn't ride the daily
ch→main promotion until we choose to ship it.

## 2. Strategy (why we think this wins)

- **The field is tiny and demand-poor**: at last measure the whole
  challenge had ~$204 of settled volume. The leader (api.syraa.fun, 6 good
  endpoints) has ~$176; a 466-endpoint mass-lister has ~$21. Lesson:
  **listing count doesn't win — real payers win.** Our plan optimizes for
  recurring third-party demand (SDK, MCP, playground, outreach), not
  catalog size.
- **Aggregator position**: one merchant aggregates the Algorand-side demand
  for the entire x402 economy. Judges score real usage, use-case quality,
  technical execution, long-term potential — a gateway that gives Algorand
  the largest x402 catalog of any chain on day one speaks to all four.
- **Entry model is organizer-approved** (Discord, 2026-07-25): cross-chain
  fulfilment ✅, wrapping third-party public x402 APIs ✅, with ONE hard
  requirement: **a single Algorand payTo for the whole entry** (that's our
  Composite design — every route settles to one address; the facilitator
  rolls it into one merchant row).
- **Only-we-can moat**: catalog selection, trust tiers, liveness probes,
  and price intelligence come from the Agents-Trust census via its public
  API (zero repo coupling).

## 3. Assumptions we are operating under

1. **Leaderboard = real settled USDC** through GoPlausible during an
   **unannounced October window** → sustained usage beats spikes; nothing
   may be self-generated (our `/receipts` page is public proof-of-payers,
   and it must stay clean — never route our own probe/test traffic
   through the gateway for volume).
2. **One payTo forever** — the merchant address is the competition
   identity. Never introduce a second one; never reuse it across domains.
3. **Census accuracy**: catalog quality rests on the agents-trust API
   (tiers, liveness, prices). Tier drift exists (live CH scored quickintel
   "Listed" despite $152K/30d) → we **volume-qualify**: ≥$100 settled in
   30d admits a service regardless of tier, because buyers voting with
   USDC is the stronger signal.
4. **Traction pricing (since 2026-07-26)**: parity — we charge exactly the
   origin price (zero margin; leaderboard rewards volume, parity removes
   the only reason to bypass us). Per-request origin cap $1; Base-only
   fulfilment covers the demand-relevant catalog (Solana later). Float
   exposure ≈ in-flight requests; raising margin later = two constants.
5. **Settle-after-handler**: the x402 middleware verifies before the
   handler and settles only on success — our no-charge-on-failure
   guarantee rests on this (empirically confirmed; see kill-switch test).
6. **Testnet ≈ mainnet**: same facilitator and flow; cutover = flip
   `NETWORK`, payTo, and USDC ASA (10458941 → 31566704).
7. **est-USD figures** (scoreboard, stats API) are `settleCount × current
   advertised price` — an estimate, labelled as such, not an on-chain sum.

## 4. What we achieved — with the evidence

Everything below is **proven against real testnet money**, not just unit
tests.

| Achievement | Evidence |
|---|---|
| Protocol-perfect 402 on every paid route | Decoded challenge: exact scheme, Algorand CAIP-2, µUSDC amount, USDC ASA, our payTo, `x402-global-challenge` tag, facilitator feePayer — byte-shape identical to live Bazaar entries; served in ~5–8ms |
| **Real settlements end-to-end** | `/trust` paid twice via smoke: e.g. txid `5JLDXIR6KXJS4WM3KY6INY7GYCZW7IFB7POPKBXHA57HR6MUXZOA` (round 65664422), $0.005 USDC buyer→merchant through GoPlausible; ledger math exact |
| **Never-charge-when-refusing** | KILL_SWITCH=on → real payment client got `503 kill_switch` and **zero USDC moved** (balances re-checked on-chain) |
| **MCP server** (`roam402-mcp`) | Real stdio agent session: initialize → tools/list (5 tools) → `roam_balance` (live algod) → `roam_trust` **paid $0.005 through an MCP tool call** (debit confirmed on-chain) |
| **Cryptographically verifiable receipts** | `pnpm verify:receipt`: real paid call → EdDSA JWS receipt → **signature VERIFIED against the public key embedded in its did:jwk kid** (payer, network, resourceUrl attested; no key registry, no server trust) |
| Catalog v2 | 50 routes · 23 services · 15 POST, generated from the census; includes the two highest-demand services in the economy (blockrun LLM completions $0.0001, quickintel scans); https-normalised, method-aware dedupe, explicit interfaces ranked first |
| Self-healing catalog | Cron sweep probes origins **unpaid** (an HTTP 402 reply proves alive + x402-speaking, zero spend); verdicts in KV; guard refuses "down" routes **before** payment |
| Buyer-safety guard order | kill switch → route exists → breaker/health → wallet present → spend cap — all **before** the 402 is ever issued, so agents never sign for a doomed call |
| Product surfaces | `/` landing (Agents-Trust design system: Darker Grotesque / DM Sans / DM Mono, Validatier light palette), `/playground` (Inspect-402 works for anyone; Pera pay flow in beta), `/catalog`, `/receipts` (+ .json), `/api/challenge-stats` (CORS-open aggregation), `/llms.txt`, `/.well-known/agents.json` |
| SDK (`roam402` npm-ready) | `createRoamClient({signer})` → `.call/.trust/.precheck/.catalog` + payment-enabled fetch; wallet-adapter compatible; `signerFromMnemonic` helper |
| Scoreboard page (agentscan `algorand` branch) | `/algorand/` — KPI cards + bar-fill merchant leaderboard from the facilitator's CORS-open discovery API; pure aggregation lib with unit tests; agentscan gate 619/619 |
| Hard-won engineering facts | `await server.initialize()` is mandatory (the middleware's lazy facilitator sync races under Node → empty accepts, and hangs under workerd); pnpm name collision (root pkg renamed `roam402-gateway` so the SDK owns `roam402`); zombie-workerd port drift (kill by `lsof -ti:8787`, not pkill) |

## 5. How to test everything yourself

```bash
cd roam402 && pnpm install && pnpm typecheck        # both tsconfigs, expect 0 errors
pnpm catalog:generate                                # regenerates catalog/routes.json from the live census API
```

**Gateway + free surfaces** (no funds needed):

```bash
pnpm dev                                             # http://localhost:8787
curl -s localhost:8787/healthz                       # {"ok":true,...,"fulfilment":...}
curl -s localhost:8787/catalog | head -c 400
open http://localhost:8787/            # landing     (brand check)
open http://localhost:8787/playground  # Inspect 402 works with zero wallet
curl -sD - -o /dev/null "localhost:8787/trust?domain=x" | grep -i payment-required
#   → HTTP 402 + base64 PAYMENT-REQUIRED header; decode it to see amount/asset/tag/feePayer
curl -s localhost:8787/api/challenge-stats | python3 -m json.tool | head -20
```

**Paid flow** (testnet; accounts in `.secrets/`, funded — buyer had ~19.97
USDC at writing; verify balances any time):

```bash
curl -s https://testnet-api.algonode.cloud/v2/accounts/VKBLLIKMUDZWUECFTNXSBEER67GNSI55EF5VVRY5DZUSO75IOITXDJDLAM | python3 -m json.tool | grep -A2 10458941
pnpm smoke              # real $0.005 payment → HTTP 200 + PAYMENT-RESPONSE + signed receipt
pnpm verify:receipt     # pays again AND cryptographically verifies the JWS receipt
```

**Safety drill**: set `KILL_SWITCH=on` in `.dev.vars`, restart, `pnpm smoke`
→ expect `503 {"error":"kill_switch"}` and the buyer balance unchanged.
Restore to `off`.

**MCP server** (this is the demo that sells it — add to any MCP host):

```json
{ "mcpServers": { "roam402": {
    "command": "pnpm", "args": ["--dir", "<repo>/", "mcp"],
    "env": { "ROAM_MNEMONIC": "<25 words from .secrets/testnet-buyer.json>",
             "ROAM_NETWORK": "testnet",
             "ROAM_GATEWAY_URL": "http://localhost:8787" } } } }
```

Then ask the agent to "check my roam402 balance, then get a trust report
for blockrun.ai" — the second one settles real USDC.

**Scoreboard page**: `cd ../agentscan && git checkout algorand && pnpm dev`
→ http://localhost:3000/algorand/ (also `pnpm test` → 619 green).

## 5b. Concurrency & money-safety findings (soak test, 2026-07-26)

`pnpm soak [n]` fires N simultaneous paid calls and then asserts the
AGGREGATE ledger on both chains. What it proved:

- **Money-safety holds under load.** Every soak run PASSES its ledger
  assertion: successes ⇔ exactly that many payments on both chains — no
  double-pay, no phantom charge. Failed requests fail *cleanly* (before or
  without leaving a paid-but-undelivered leak).
- **Single call: exact and reliable.** Loop test green every time.
- **Throughput ceiling ≈ 2–3 concurrent** against the mock origin + the
  shared GoPlausible facilitator. Each end-to-end call is ~4 facilitator
  round-trips (our verify+settle + the origin's verify+settle), so a burst
  serialises on the facilitator; excess calls 502. This is largely
  (a) a test-rig limit — the mock origin is a single Node process; real
  origins (blockrun, quickintel) scale — and (b) a shared-ecosystem limit
  every entrant hits, not a roam402 bug.
- **A client-side outbound limiter was tried and REVERTED** — an in-isolate
  queue holds requests past workerd's hang-detection deadline and turns
  load into 500s. The wrong tool; documented so nobody re-adds it.

Production takeaway: the leaderboard is measured over a window, so sustained
sequential throughput matters more than burst concurrency. What we control —
no leak, clean fails, `retryable` signals, per-route breaker shedding dead
origins — holds. The residual paid-but-undelivered risk (origin settles,
delivery fails) is bounded at the origin price, in the safe direction
(buyer never overcharged), and accepted like a merchant accepts chargebacks.

## 6. What we missed / open gaps (honest list)

1. ~~The full cross-chain loop is unproven~~ — **PROVEN 2026-07-26** on
   pure testnets (Algorand testnet in → Base SEPOLIA out via the same
   facilitator, faucet money only): buyer −$0.0017 / merchant +$0.0017 on
   Algorand, hot −$0.001 / origin seller +$0.001 on Sepolia — asserted
   on-chain, margin model exact; origin settlement decoded into the
   receipt (eip155:84532, tx 0xf9a98aec…132f75). Rerun any time:
   `pnpm origin:dev` + `pnpm dev` + `pnpm loop:test`. Remaining flavor of
   the gap: first MAINNET-origin call (real Base) after float funding.
2. **Playground Pera flow is beta and browser-untested** (esm.sh builds +
   Pera signer adapter written but never clicked through). Inspect-402
   tier is verified working.
3. **Streaming SSE through the paid path is impossible by design** — the
   x402 middleware buffers the body (`res.clone().arrayBuffer()`) to
   settle after delivery; correct tradeoff (can't un-send a stream if
   settlement fails). Documented, deliberately not worked around.
4. **KV not provisioned** → receipts log and health-sweep are inert until
   `wrangler kv namespace create` at deploy (they degrade gracefully);
   the 30-min cron is commented until then.
5. **Bazaar listing untestable before mainnet** — the tag, merchant page
   enrichment (NFD, metadata), and leaderboard row only materialize after
   the first real mainnet settlement.
6. **Discovery schemas only on native routes** — wrapped origins' input
   schemas are unknowable honestly; revisit per-route for the top 10.
7. **Not yet published/shipped**: sdk + mcp to npm (waiting for the
   mainnet gateway URL), scoreboard branch not merged/deployed, outreach
   not started (playbook ready; cadence starts when we're live).
8. **Dev receipt-signing key is burnt** (it appeared in logs) — mainnet
   MUST mint a fresh one (`pnpm receipt:key` → `wrangler secret put
   RECEIPT_SIGNING_JWK`). Same for a fresh look at all secrets at deploy.
9. **Phase-2 backlog**: Solana-side fulfilment; per-service co-marketing;
   `upto`/metered pricing exploration.

## 7. Next steps (ordered)

**Human steps (Kaleab) — the only blockers:**
1. Buy the domain (working name `roam402.com`; final call open).
2. Mainnet merchant wallet in Pera/Defly → opt in to USDC ASA `31566704`
   → register an NFD. **This payTo is permanent** for the competition.
3. Base hot wallet: fresh key, ~$300 USDC + a little ETH gas.
4. A few mainnet USDC (Algorand side) in a buyer wallet for the first
   ceremonial settlement.
5. Ten minutes with Pera on the playground (testnet) to bless/kill the
   beta pay flow.

**Then (assistant, ~one sitting; details in RUNBOOK):**
6. Mainnet cutover: fresh secrets, `NETWORK=mainnet`, payTo, KV namespace,
   enable cron, deploy, attach custom domain.
7. **First real mainnet settlement** → confirms Bazaar listing with the
   challenge tag + merchant row (the official "finish line" checklist).
8. Prove the full cross-chain wrapped call (gap #1) with the $0.0001 route.
9. Publish `roam402` + `roam402-mcp` to npm; PR the scoreboard
   (`algorand` → main via ch flow) so agents-trust.com hosts the public
   challenge leaderboard.
10. **P3 demand engine** (docs/OUTREACH.md): DM all current Bazaar
    merchants (they're building agents that need services), Foundation +
    GoPlausible amplification, origin-seller co-marketing, SDK/MCP
    distribution. Cadence: week of Aug 4.
11. September: submission form + demo video; the `/receipts` page is our
    standing "proof of who is paying".
12. October: freeze. Change nothing, watch alerts, stay up — the window is
    unannounced and volume is measured live.

## 8. Current on-chain state (testnet)

- Buyer `VKBL…DLAM`: ~10 ALGO, ~19.97 USDC (started 20; each paid test
  = −$0.005, incl. via MCP and receipt-verify).
- Merchant `3CPT…DY3Q`: ~10 ALGO, ~0.02 USDC — every cent of it settled
  through GoPlausible by our own flows.
- Git: everything committed on `main` of this repo (see `git log
  --oneline` — P0 → Tier 1 → Tier 2 tell the story in order); agentscan
  scoreboard on the `algorand` branch. Nothing is pushed anywhere without
  Kaleab's say-so.
