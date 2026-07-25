/**
 * examples/agent-call.ts — the three-line pitch, runnable.
 *
 *   ROAM_MNEMONIC="…25 words…" pnpm tsx examples/agent-call.ts [gatewayUrl]
 *
 * 1. precheck an unknown endpoint before trusting it   ($0.002)
 * 2. trust-report a seller domain                      ($0.005)
 * 3. pay-per-call LLM completion through the gateway   (~$0.0006)
 *
 * All three settle USDC on Algorand; the LLM call is fulfilled on Base and
 * returns receipts from both chains.
 */

import { createRoamClient, signerFromMnemonic } from "../sdk/src/index";

const mnemonic = process.env.ROAM_MNEMONIC;
if (!mnemonic) throw new Error("Set ROAM_MNEMONIC (25-word Algorand mnemonic)");

const roam = createRoamClient({
  signer: await signerFromMnemonic(mnemonic),
  network: "testnet",
  gatewayUrl: process.argv[2] ?? "http://localhost:8787",
});

// 1 — never pay a stranger: precheck first.
const check = await roam.precheck("https://blockrun.ai/api/v1/chat/completions");
console.log("precheck:", check.verdict, `(tier: ${check.trust_tier})`);

// 2 — full trust report.
const trust = await roam.trust("blockrun.ai");
console.log("trust:", trust.trust_tier, "· volume:", trust.verified_volume_usd_total);

// 3 — pay-per-call LLM inference, USDC on Algorand, fulfilled on Base.
const res = await roam.call("blockrun-chat-completions", {
  body: {
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "One sentence: why do agents need pay-per-call?" }],
  },
});
console.log("LLM HTTP", res.status);
console.log("origin receipt:", res.headers.get("X-Roam-Origin-Receipt")?.slice(0, 40) ?? "—");
console.log(await res.text());
