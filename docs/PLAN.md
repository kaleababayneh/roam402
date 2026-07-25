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
| P0 testnet | Jul 25–29 | smoke-client pays the gateway end-to-end on testnet; settle-after-handler confirmed |
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

- [ ] Organizer confirmation (Discord): cross-chain fulfilment + third-party
      API resale is an acceptable orchestrator/composite entry.
- [ ] Domain purchase + NFD registration.
- [ ] Mainnet payTo + Base float (human steps — docs/RUNBOOK.md).
- [ ] Phase-2: Solana-side fulfilment; per-route input schemas
      (declareDiscoveryExtension) for richer Bazaar entries.
