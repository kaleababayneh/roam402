# roam402-mcp

MCP server for [Roam402](https://roam402.com): give any tool-calling agent
(Claude, Cursor, anything MCP) the whole x402 economy — 2,349 routes across
751 verified services — paid in USDC on Algorand mainnet. Five tools, one
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
| `roam_catalog` | free | Browse every callable service: routes, USDC prices, trust tiers |
| `roam_balance` | free | The paying wallet's ALGO + USDC balance |
| `roam_trust` | $0.0005 | Agents-Trust trust report for any x402 seller domain |
| `roam_precheck` | $0.0002 | Safety check before paying an unknown x402 endpoint |
| `roam_call` | per route | Call any wrapped service (LLM inference, token scans, market data…) with dual-chain receipts |

Custody: the mnemonic stays in the MCP host's env and signs locally — only
signed payment payloads leave the process. Paid results include settlement
receipts; errors return as readable `isError` content (e.g. insufficient
USDC) so the agent can react. `ROAM_GATEWAY_URL` overrides the gateway for
staging/local use.
