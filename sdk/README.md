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

const catalog = await roam.catalog();                       // free discovery
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
