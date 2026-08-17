/**
 * mcp/src/setup.ts — the first-run experience.
 *
 * An MCP server talks JSON-RPC over stdin, so it can never prompt an agent
 * host for anything. But when a HUMAN runs `npx roam402-mcp` in a terminal,
 * stdin is a TTY and no agent is listening — that is a person trying the tool,
 * and the right response is a wallet setup wizard, not a stack trace.
 *
 * We only ever WRITE a mnemonic where the user asks us to, and we print the
 * warning before the words, not after.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import algosdk from "algosdk";
import { USDC_ASA, type RoamNetwork } from "./config.js";

const B = (s: string) => `\u001b[1m${s}\u001b[0m`;
const DIM = (s: string) => `\u001b[2m${s}\u001b[0m`;
const WARN = (s: string) => `\u001b[33m${s}\u001b[0m`;
const OK = (s: string) => `\u001b[32m${s}\u001b[0m`;

function configSnippet(mnemonic: string, network: RoamNetwork): string {
  return JSON.stringify(
    {
      mcpServers: {
        roam402: {
          command: "npx",
          args: ["roam402-mcp"],
          env: { ROAM_MNEMONIC: mnemonic, ROAM_NETWORK: network },
        },
      },
    },
    null,
    2
  );
}

/**
 * Runs when a human starts the server with no wallet configured.
 * Returns true if the caller should exit (we printed instructions).
 */
export async function runSetupWizard(network: RoamNetwork): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write(`
${B("roam402-mcp")} — give your agent the x402 economy, paid in USDC on Algorand.

This is an ${B("MCP server")}: it is meant to be launched by an agent host
(Claude Code, Claude Desktop, Cursor), not run directly. It needs an Algorand
wallet to pay for calls — that wallet stays on this machine and only signed
payments ever leave it.

${DIM("Browsing the catalog is free and needs no wallet. Paying for a call does.")}

`);

    // Ctrl+D / a closed stdin rejects the question — that is a decline, not a
    // crash. Anything unexpected here must still leave the user with guidance.
    let answer = "";
    try {
      answer = (await rl.question(`Create a new Algorand wallet now? ${DIM("[y/N]")} `))
        .trim()
        .toLowerCase();
    } catch {
      answer = "";
      stdout.write("\n");
    }

    if (answer !== "y" && answer !== "yes") {
      stdout.write(`
No problem. To use a wallet you already have, put its 25-word mnemonic in your
agent host's MCP config:

${DIM(configSnippet("word1 word2 … word25", network))}

Or export it for a quick try:  ${B("export ROAM_MNEMONIC=\"word1 … word25\"")}

You can also start the server with no wallet at all — the free tools
(roam_catalog, roam_schema) work, and the paid ones will tell you what is
missing rather than failing mysteriously.
`);
      return true;
    }

    const account = algosdk.generateAccount();
    const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
    const address = account.addr.toString();

    stdout.write(`
${WARN("⚠  These 25 words ARE the wallet. Anyone who has them can spend it.")}
${WARN("   Store them in a password manager. Do not commit them to a repo.")}

${B("Address")}   ${address}
${B("Mnemonic")}  ${mnemonic}

${B("To fund it")} (${network}):
  1. Send USDC to the address above  ${DIM(`(asset ID ${USDC_ASA[network]})`)}
  2. Send a little ALGO for transaction fees
  3. Opt in to the USDC asset — most wallets do this automatically on receive
  ${DIM("Then ask your agent to run roam_balance to confirm.")}

${B("Add this to your agent host's MCP config:")}

${configSnippet(mnemonic, network)}

${OK("Done.")} Restart your agent host and ask it: "what can I buy through roam402?"
`);
    return true;
  } finally {
    rl.close();
  }
}
