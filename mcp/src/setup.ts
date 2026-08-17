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
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import algosdk from "algosdk";
import { USDC_ASA, defaultKeyPath, type RoamNetwork } from "./config.js";

/** Where a generated wallet is stored: one file, owner-read-only. */
const KEY_DIR = join(homedir(), ".roam402");
const keyPath = defaultKeyPath;

const B = (s: string) => `\u001b[1m${s}\u001b[0m`;
const DIM = (s: string) => `\u001b[2m${s}\u001b[0m`;
const WARN = (s: string) => `\u001b[33m${s}\u001b[0m`;
const OK = (s: string) => `\u001b[32m${s}\u001b[0m`;

function configSnippet(env: Record<string, string>): string {
  return JSON.stringify(
    { mcpServers: { roam402: { command: "npx", args: ["roam402-mcp"], env } } },
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

${DIM(
      configSnippet({ ROAM_MNEMONIC_FILE: keyPath(network), ROAM_NETWORK: network })
    )}

…and put the 25 words in that file, readable only by you:

  ${B(`mkdir -p ${KEY_DIR} && umask 077 && cat > ${keyPath(network)}`)}

${DIM("A path is not a secret. Keeping the key out of the config means it is not")}
${DIM("synced, backed up, or pasted into an issue along with your settings.")}

You can also start the server with no wallet at all — the free tools
(roam_catalog, roam_schema) work, and the paid ones will tell you what is
missing rather than failing mysteriously.
`);
      return true;
    }

    const account = algosdk.generateAccount();
    const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
    const address = account.addr.toString();

    // Written, not printed: a key on screen ends up in scrollback, in a
    // screenshot, or pasted into a chat. 0600, and the directory too.
    let stored: string | null = null;
    try {
      mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
      writeFileSync(keyPath(network), mnemonic + "\n", { mode: 0o600 });
      stored = keyPath(network);
    } catch {
      stored = null;
    }

    stdout.write(`
${OK("Wallet created.")}  ${B("Address")}  ${address}

${
      stored
        ? `Its 25 words are saved to ${B(stored)} ${DIM("(readable only by you)")}.
${WARN("⚠  That file IS the wallet — anyone who reads it can spend it.")}
${WARN("   Back it up somewhere safe. Never commit or paste it.")}
${DIM("   To see the words:")} ${B(`cat ${stored}`)}`
        : `${WARN("⚠  Could not write the key file, so here are the 25 words ONCE.")}
${WARN("   Save them in a password manager now — they are the wallet.")}

  ${mnemonic}`
    }

${B("To fund it")} (${network}) ${DIM("— this order matters on Algorand:")}
  1. Send ${B("ALGO")} first ${DIM("(~0.3 to be safe)")} — an account needs a minimum
     balance to exist, plus 0.1 more to hold any asset, plus fees.
  2. ${B("Opt in to USDC")} ${DIM(`(asset ID ${USDC_ASA[network]})`)} — run:

       ${B("npx roam402-mcp --optin")}

     ${DIM("No wallet app needed; this signs the 0-amount self-transfer for you.")}
     ${WARN("USDC sent before this step will FAIL")} — an Algorand account cannot
     receive an asset it has not opted into.
  3. ${B("Send USDC")} to the address above.

  ${DIM("Check progress at any time with")} ${B("npx roam402-mcp --status")}

${B("Add this to your agent host's MCP config:")}

${configSnippet({ ROAM_MNEMONIC_FILE: stored ?? keyPath(network), ROAM_NETWORK: network })}

${OK("Done.")} Restart your agent host and ask it: "what can I buy through roam402?"
`);
    return true;
  } finally {
    rl.close();
  }
}
