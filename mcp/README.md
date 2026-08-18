# roam402-mcp

MCP server for [Roam402](https://roam402.com): give any tool-calling agent
(Claude, Cursor, anything MCP) the whole x402 economy — 2,500 routes across
837 verified services — paid in USDC on Algorand mainnet. eight tools, one
config block, no code.

```json
{
  "mcpServers": {
    "roam402": {
      "command": "npx",
      "args": ["roam402-mcp"],
      "env": {
        "ROAM_MNEMONIC": "…25-word Algorand mnemonic…",
        "ROAM_NETWORK": "mainnet"
      }
    }
  }
}
```

| Tool | Cost | What it does |
|---|---|---|
| `roam_resolve` | $0.0005 | Describe what you need in plain English, get a ranked shortlist. Suggests only, never calls or pays |
| `roam_catalog` | free | Browse or search every callable route, with filters and paging |
| `roam_schema` | free | What inputs a route expects, read from the origin's own payment challenge |
| `roam_call` | per route | Calls a route. Pays the 402 and returns the body plus receipts |
| `roam_trust` | $0.0005 | Trust report for a seller domain |
| `roam_precheck` | $0.0002 | Vets any x402 URL before you pay it |
| `roam_optin` | ALGO fees | Opts the wallet in to USDC, required once before it can receive any |
| `roam_balance` | free | The paying wallet's ALGO and USDC balance |

### Getting ALGO

An Algorand account needs 0.21 ALGO before it can hold USDC at all (0.1 to
exist, 0.1 more per asset, plus fees). On mainnet that is a real asset you buy
on any exchange listing ALGO and withdraw to the address, choosing the Algorand
network.

To try it for free, use testnet instead. Set `ROAM_NETWORK=testnet`, run the
wizard, and fund the address from the faucet at
https://bank.testnet.algorand.network

Routes cost $0.0001 to a few cents, so a dollar or two of USDC buys thousands
of calls.

### Connecting it to your agent

```
npx roam402-mcp install            # detects Claude Code, Claude Desktop, Cursor, Codex
npx roam402-mcp install --client cursor   # or pick one
```

It merges into each client's own config format — never clobbering servers you
already have, backing up every file it touches, and doing nothing on a re-run.
Prefer to do it by hand? `npx roam402-mcp install` prints the JSON if it finds
no client, and declining the prompt prints it too.

### Setting up a wallet (no wallet app needed)

```
npx roam402-mcp            # creates a wallet, saves it to ~/.roam402/<network>.mnemonic (0600)
                           # …fund it: see 'Getting ALGO' below…
npx roam402-mcp --optin    # opt in to USDC — REQUIRED before it can receive any
                           # …send it USDC…
npx roam402-mcp --status   # address, balances, opt-in state
```

On Algorand an account cannot **receive** an asset it has not opted into, and
the opt-in is a transaction the account signs itself — so ALGO must arrive
first. `--optin` does that signing for you; no Pera or other wallet app is
required at any point.

**No wallet yet?** Run `npx roam402-mcp` in a terminal — it walks you through
creating one and prints the config to paste into your agent host. Without a
wallet the server still starts read-only: `roam_catalog` and `roam_schema`
work, and the paid tools tell you what is missing.


Custody: the mnemonic stays in the MCP host's env and signs locally — only
signed payment payloads leave the process. Paid results include settlement
receipts; errors return as readable `isError` content (e.g. insufficient
USDC) so the agent can react. `ROAM_GATEWAY_URL` overrides the gateway for
staging/local use.
