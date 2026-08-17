/**
 * mcp/src/config.ts — environment contract for the MCP server.
 *
 * The buyer's wallet NEVER leaves this process: the mnemonic arrives via env
 * (set in the agent host's MCP config), signs locally, and only signed
 * payment payloads go over the wire. We never log or echo key material.
 *
 * A MISSING mnemonic is not an error. Discovery is free, so the server starts
 * read-only and only the paid tools object — crashing on startup would mean a
 * host that lists the server shows nothing at all, and a human who runs it to
 * try it out gets a stack trace instead of an explanation.
 */

export type RoamNetwork = "testnet" | "mainnet";

export interface McpConfig {
  /** null → read-only: free tools work, paid tools explain themselves. */
  mnemonic: string | null;
  network: RoamNetwork;
  /** Optional gateway override (e.g. http://localhost:8787 during dev). */
  gatewayUrl?: string;
}

export const ALGOD_URL: Record<RoamNetwork, string> = {
  testnet: "https://testnet-api.algonode.cloud",
  mainnet: "https://mainnet-api.algonode.cloud",
};

export const USDC_ASA: Record<RoamNetwork, number> = {
  testnet: 10458941,
  mainnet: 31566704,
};

/** Words in a valid Algorand mnemonic — checked before we try to use it. */
const MNEMONIC_WORDS = 25;

export function loadMcpConfig(env: NodeJS.ProcessEnv): McpConfig {
  const raw = env.ROAM_MNEMONIC?.trim();
  const words = raw ? raw.split(/\s+/).length : 0;
  return {
    // A wrong-length mnemonic is a typo, not a wallet: treat it as absent so
    // the server still starts and the reason is reported once, clearly.
    mnemonic: raw && words === MNEMONIC_WORDS ? raw : null,
    network: env.ROAM_NETWORK === "testnet" ? "testnet" : "mainnet",
    gatewayUrl: env.ROAM_GATEWAY_URL?.trim() || undefined,
  };
}

/** Why the wallet is unusable, for a one-line startup note. null = it's fine. */
export function mnemonicProblem(env: NodeJS.ProcessEnv): string | null {
  const raw = env.ROAM_MNEMONIC?.trim();
  if (!raw) return "no ROAM_MNEMONIC set";
  const words = raw.split(/\s+/).length;
  if (words !== MNEMONIC_WORDS) {
    return `ROAM_MNEMONIC has ${words} word${words === 1 ? "" : "s"}, expected ${MNEMONIC_WORDS}`;
  }
  return null;
}
