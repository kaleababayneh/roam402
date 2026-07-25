/**
 * mcp/src/index.ts — assembly only: config → roam client → tools → stdio.
 *
 * Add to an agent host (Claude Code .mcp.json, Claude Desktop, Cursor…):
 *
 *   {
 *     "mcpServers": {
 *       "roam402": {
 *         "command": "npx",
 *         "args": ["roam402-mcp"],
 *         "env": { "ROAM_MNEMONIC": "…25 words…", "ROAM_NETWORK": "mainnet" }
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRoamClient, signerFromMnemonic } from "roam402";
import { loadMcpConfig } from "./config";
import { registerTools } from "./tools";

const cfg = loadMcpConfig(process.env);
const signer = await signerFromMnemonic(cfg.mnemonic);
const roam = createRoamClient({
  signer,
  network: cfg.network,
  gatewayUrl: cfg.gatewayUrl,
});

const server = new McpServer({ name: "roam402", version: "0.1.0" });
registerTools(server, roam, cfg, signer.address);

await server.connect(new StdioServerTransport());
console.error(`roam402-mcp ready · ${cfg.network} · wallet ${signer.address.slice(0, 8)}…`);
