# Roam402 — the x402 roaming gateway

**Every verified x402 service, payable in USDC on Algorand.** By
[Agents-Trust](https://agents-trust.com).

Agents on Algorand get the entire x402 economy — market data, token safety,
inference, tools — through one merchant: pay USDC on Algorand (settled by the
GoPlausible facilitator), Roam402 fulfils the call on the service's home
chain from its own treasury, and returns the response with **dual-chain
receipts** (Algorand settlement + origin settlement).

Routes are generated from the Agents-Trust census — the index of $45M+ of
real x402 settlement — and only trust-tiered, liveness-probed services are
wrapped. Native routes (`/trust`, `/precheck`) sell the trust layer itself.

```
GET /catalog            free    everything callable, prices, tiers
GET /r/{slug}           paid    wrapped service call (query params forwarded)
GET /trust?domain=      $0.005  Agents-Trust tier + score + evidence
GET /precheck?url=      $0.002  pre-flight safety check for any x402 endpoint
```

Entry in the Algorand Global x402 Challenge — Composite merchant (all routes
share one payTo) with orchestrator-style cross-chain fulfilment.

- Architecture: `src/index.ts` header comment.
- Plan & strategy: `docs/PLAN.md`.
- Setup & operations: `docs/RUNBOOK.md`.
