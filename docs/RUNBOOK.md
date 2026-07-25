# Roam402 runbook — human steps & operations

## Phase P0 — testnet (no real money anywhere)

1. `pnpm install && pnpm catalog:generate && pnpm typecheck`
2. `pnpm account:new` → fund the printed address:
   - test ALGO: <https://bank.testnet.algorand.network>
   - opt in to USDC ASA `10458941` (0-amount asset transfer to self), then get
     test USDC (Circle testnet faucet, or ask in Algorand Discord).
3. Copy `.dev.vars.example` → `.dev.vars`; set `PAY_TO_ADDRESS` to a SECOND
   testnet account (merchant side — run `pnpm account:new` twice or reuse any
   testnet address you control; it must be opted in to ASA 10458941).
4. `pnpm dev` then in another terminal `pnpm smoke` — success = HTTP 200 with
   an `X-PAYMENT-RESPONSE` header and USDC moved between the two testnet
   accounts. **Also confirms settle-after-handler:** run once with
   `KILL_SWITCH=on` and verify the buyer is NOT debited on the 503.

## Phase P1 — mainnet cutover (real money — every step is yours)

1. Create the merchant payTo in Pera/Defly. **This address is permanent for
   the whole competition** (leaderboard identity). Opt in to USDC ASA
   `31566704`. Register an NFD for it (shiny merchant page).
2. Create a fresh Base hot wallet; fund ~$300 USDC + a little ETH for gas.
3. `wrangler secret put BASE_WALLET_PRIVATE_KEY` (paste key; never in files).
4. wrangler.toml: `NETWORK = "mainnet"`, `PAY_TO_ADDRESS = <merchant addr>`.
5. Buy/attach the production domain (Workers custom domain) — one root
   domain per merchant, per the challenge rules.
6. `pnpm deploy`, then make ONE real payment (smoke-client with a funded
   mainnet buyer account, smallest route) — the official "finish line":
   paid response + USDC lands in payTo + endpoint appears in the Bazaar with
   the `x402-global-challenge` tag (check the global-hackathon filter).
7. Enrich the merchant page: site metadata, logo, `.well-known`/agents.json.

## Operations

- **Kill switch**: set `KILL_SWITCH=on` (env var) + redeploy — all paid
  routes 503 BEFORE payment; buyers are never charged during an incident.
- **Float**: watch the Base wallet balance; refill before it dips below ~20
  typical requests. Rebalance Algorand-side USDC ~monthly via an exchange
  (CCTP does not cover Algorand).
- **Catalog refresh**: `pnpm catalog:generate` → review the diff → deploy.
  Never widen PRICE_CAP without rechecking the float math.
- **Never** route Agents-Trust's own probe/delivery-test traffic through the
  gateway — leaderboard volume must be third-party only.
