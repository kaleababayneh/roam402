# roam402

Client SDK for [Roam402](https://roam402.com) — **2,349 routes across 751
verified x402 services**, payable in USDC on Algorand mainnet. One merchant, dual-chain receipts, trust tiers
from the [Agents-Trust](https://agents-trust.com) census.

```bash
npm i roam402            # algosdk optional (only for signerFromMnemonic)
```

```ts
import { createRoamClient, signerFromMnemonic } from "roam402";

const roam = createRoamClient({
  signer: await signerFromMnemonic(process.env.ALGO_MNEMONIC!),
  network: "mainnet",
});

const catalog = await roam.catalog();                       // free, paged (25/page)
const page2   = await roam.catalog({ offset: 25 });         // …walk it with total/next
const found   = await roam.catalog({ q: "speech", maxPrice: 0.01, method: "POST" });

// Or just say what you need ($0.0005) — returns candidates, never buys them:
const { candidates } = await roam.resolve("transcribe an audio file", { limit: 3 });
const inputs = await roam.schema(candidates[0].path);       // free: what it expects
const trust   = await roam.trust("blockrun.ai");            // $0.0005
const check   = await roam.precheck("https://…/endpoint");  // $0.0002
const scan    = await roam.call("quickintel-scan-full", {   // wrapped route
  query: { chain: "base", tokenAddress: "0x…" },
});
```

- **`roam.fetch`** — a payment-enabled `fetch`: hand it to any HTTP client
  (OpenAI SDK `fetch` option, axios adapter, LangChain tool) and that code
  transparently answers 402 challenges with signed Algorand payments.
- **Signers** — anything implementing `{ address, signTransactions }`
  (use-wallet / Pera adapters work), or `signerFromMnemonic` server-side.
- **Receipts** — paid responses carry `PAYMENT-RESPONSE` (Algorand
  settlement), `X-Roam-Origin-Chain` / `X-Roam-Origin-Tx` (origin-chain
  settlement), and an EdDSA-signed JWS receipt verifiable offline against
  the `did:jwk` in its own key id.

Payments settle through the GoPlausible facilitator; the buyer needs only
USDC on Algorand — no account, no API key, no gas (fee abstraction).

## Concurrency

Paid calls can run in parallel. The client serialises only the few milliseconds
of payment construction, because two payments built by one wallet in the same
millisecond are byte-identical and Algorand rejects the duplicate — an agent
firing four calls at once would see three fail with an unexplained 402.

Give each agent its own wallet: the guard covers one client, so two processes
sharing a mnemonic can still collide.
