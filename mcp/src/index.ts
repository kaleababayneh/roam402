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
 *
 * Three ways this process gets started, and it must behave in all of them:
 *   - agent host, wallet configured → full server
 *   - agent host, NO wallet         → read-only server (free tools still work,
 *                                     paid ones explain what is missing)
 *   - a human in a terminal         → stdin is a TTY, so no agent is driving:
 *                                     run the setup wizard instead of sitting
 *                                     silently or dying on a missing env var
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRoamClient, signerFromMnemonic } from "roam402";
import { loadMcpConfig, mnemonicProblem } from "./config.js";
import { registerTools } from "./tools.js";
import { runSetupWizard } from "./setup.js";

const cfg = loadMcpConfig(process.env);

// A TTY on stdin means a person ran this, not an agent host: help them.
if (!cfg.mnemonic && process.stdin.isTTY) {
  await runSetupWizard(cfg.network);
  process.exit(0);
}

let signer: Awaited<ReturnType<typeof signerFromMnemonic>> | undefined;
if (cfg.mnemonic) {
  try {
    signer = await signerFromMnemonic(cfg.mnemonic);
  } catch (err) {
    // A malformed mnemonic must not take the server down — the free tools are
    // still perfectly usable, and the tools report the reason on demand.
    console.error(
      `roam402-mcp: could not load the wallet (${err instanceof Error ? err.message : err}). ` +
        `Starting READ-ONLY — free tools work, paid tools will explain.`
    );
  }
}

const roam = createRoamClient({ signer, network: cfg.network, gatewayUrl: cfg.gatewayUrl });

const server = new McpServer({ name: "roam402", version: "0.2.0" });
registerTools(server, roam, cfg, signer?.address);

await server.connect(new StdioServerTransport());

if (signer) {
  console.error(`roam402-mcp ready · ${cfg.network} · wallet ${signer.address.slice(0, 8)}…`);
} else {
  console.error(
    `roam402-mcp ready · ${cfg.network} · READ-ONLY (${mnemonicProblem(process.env)}) · ` +
      `free tools work; set ROAM_MNEMONIC to pay for calls`
  );
}
