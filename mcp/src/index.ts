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
import { runInstall } from "./install.js";
import { optInToUsdc, walletStatus } from "./wallet.js";

const cfg = loadMcpConfig(process.env);
const argv = process.argv.slice(2);
const flag = (...names: string[]) => names.some((n) => argv.includes(n));

if (flag("--help", "-h")) {
  console.log(`roam402-mcp — the x402 economy for your agent, paid in USDC on Algorand.

  npx roam402-mcp              start the MCP server (or set up a wallet, if run
                               in a terminal with none configured)
  npx roam402-mcp install      wire this server into Claude Code, Claude Desktop,
                               Cursor or Codex — no JSON to hand-edit
  npx roam402-mcp --status     address, ALGO/USDC balance, USDC opt-in state
  npx roam402-mcp --optin      opt this wallet in to USDC — REQUIRED once before
                               it can receive any. Needs ~0.21 ALGO first.
  npx roam402-mcp --help

Wallet:  ROAM_MNEMONIC_FILE=<path to a file holding 25 words>   (preferred)
         ROAM_MNEMONIC="<25 words>"
Network: ROAM_NETWORK=mainnet|testnet   (default mainnet)`);
  process.exit(0);
}

if (argv[0] === "install") {
  const at = argv.indexOf("--client");
  process.exit(
    await runInstall({
      network: cfg.network,
      only: at > -1 ? argv[at + 1] : undefined,
      yes: flag("--yes", "-y"),
    })
  );
}

// --status / --optin are the reason these exist as CLI commands: a wallet must
// be opted in BEFORE it can receive USDC, but MCP tools only become callable
// once an agent host is configured — which comes after funding. Without these,
// finishing setup would require a separate wallet app.
if (flag("--status", "--optin")) {
  if (!cfg.mnemonic) {
    console.error(
      `roam402-mcp: no wallet configured (${mnemonicProblem(process.env)}).\n` +
        `Run \`npx roam402-mcp\` with no arguments to create one.`
    );
    process.exit(1);
  }
  const { address } = await signerFromMnemonic(cfg.mnemonic);
  try {
    if (flag("--optin")) {
      const outcome = await optInToUsdc(cfg, address);
      console.log(outcome.message);
      process.exit(outcome.kind === "underfunded" ? 1 : 0);
    }
    const st = await walletStatus(cfg, address);
    console.log(
      `address   ${st.address}\n` +
        `network   ${st.network}\n` +
        `ALGO      ${st.algo}\n` +
        `USDC      ${st.optedIn ? st.usdc : "not opted in — run: npx roam402-mcp --optin"}`
    );
    process.exit(0);
  } catch (err) {
    console.error(`roam402-mcp: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

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

const server = new McpServer({ name: "roam402", version: "0.3.0" });
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
