# Roam402 — challenge execution plan (agreed 2026-07-25)

**Thesis:** the Algorand x402 ecosystem has ~11 merchants and ~$201 of total
settled volume; the existing x402 economy (Base/Solana) has $45M+. Roam402
imports the latter into the former, as a Composite merchant with
orchestrator-style cross-chain fulfilment — a model the challenge rules
explicitly define. Only Agents-Trust can do this: the census provides the
route table, trust tiers, liveness probes, and pricing intelligence.

**Win condition:** real third-party USDC settled on Algorand during an
unannounced October window. Demand > catalog size (the 466-listing
competitor has $21 settled; the 6-listing leader has $176).

## Phases

| Phase | When | Exit criterion |
|---|---|---|
| P0 testnet | ✅ done Jul 25 | 2 real settlements via GoPlausible (e.g. tx 5JLDXIR6KXJS4WM3KY6INY7GYCZW7IFB7POPKBXHA57HR6MUXZOA, $0.005 USDC buyer→merchant); kill-switch 503s with zero debit |
| P1 mainnet | Jul 30–Aug 3 | first real settlement; Bazaar listing with challenge tag; merchant page enriched |
| P2 scale | Aug 4–15 | ~50 wrapped routes + /trust + /precheck live; SDK (`roam402` npm) published; receipts page |
| P3 demand | Aug–Sep | entrant outreach (they need services), Foundation/GoPlausible amplification, origin-seller co-marketing, observatory Algorand lane |
| P4 submit | Sep | submission form + hardening |
| P5 window | Oct | change nothing; stay up |

## Principles

- Buyer is never charged for a failed origin call (guards → verify → fulfil
  → settle).
- Zero self-generated volume; the receipts page is the proof-of-payers.
- Wrapped services: Established+ tier, live-probed, ≤$1, notified + opt-out.
- Margin: origin × 1.2 + $0.0005 (see src/pricing.ts).
- One merchant, one payTo, one root domain (rules requirement).

## Open items

- [x] Organizer confirmation (Discord, 2026-07-25): **YES** to cross-chain
      fulfilment and **YES** to wrapping third-party public x402 APIs.
      Their one requirement: **a single Algorand address** for the whole
      entry so tracking is easy — which is our Composite design already.
      HARD CONSTRAINT: never introduce a second payTo.
- [x] Challenge registration submitted (2026-07-25).
- [ ] Domain purchase + NFD registration.
- [ ] Mainnet payTo + Base float (human steps — docs/RUNBOOK.md).
- [ ] Phase-2: Solana-side fulfilment; per-route input schemas
      (declareDiscoveryExtension) for richer Bazaar entries.


## Tier 2 (finalist-grade, done Jul 25)

- [x] **Signed receipts** — EdDSA/Ed25519 JWS offers + receipts (did:jwk,
      key inline in kid, WebCrypto). Proven: a real paid receipt VERIFIES
      against its embedded public key (pnpm verify:receipt) — payer,
      network, resourceUrl all cryptographically attested. Feature-flagged
      on RECEIPT_SIGNING_JWK.
- [x] **Self-healing catalog** — cron sweep probes every origin UNPAID
      (402 = alive, no spend), persists verdicts to KV; the guard refuses
      "down" routes before payment. 30-min cron (enable at deploy).
- [x] **Bazaar discovery schemas** — declareDiscoveryExtension on native
      routes (input/inputSchema/output) → richest merchant catalog entries.
- [~] **Streaming passthrough** — DEFERRED: the x402 hono middleware
      buffers the response body (res.clone().arrayBuffer()) to settle
      after delivery, so SSE can't stream through the paid path. Buffering
      is the CORRECT tradeoff (settlement must succeed before we commit the
      response — a stream can't be un-sent). Not a bug to fix; a protocol
      property to document.
