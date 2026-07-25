/**
 * mcp/src/config.ts — environment contract for the MCP server.
 *
 * The buyer's wallet NEVER leaves this process: the mnemonic arrives via env
 * (set in the agent host's MCP config), signs locally, and only signed
 * payment payloads go over the wire. We never log or echo key material.
 */

export type RoamNetwork = "testnet" | "mainnet";

export interface McpConfig {
  mnemonic: string;
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

export function loadMcpConfig(env: NodeJS.ProcessEnv): McpConfig {
  const mnemonic = env.ROAM_MNEMONIC?.trim();
  if (!mnemonic) {
    throw new Error(
      "ROAM_MNEMONIC is required (25-word Algorand mnemonic of the paying wallet). " +
        "Set it in your MCP server env config."
    );
  }
  return {
    mnemonic,
    network: env.ROAM_NETWORK === "testnet" ? "testnet" : "mainnet",
    gatewayUrl: env.ROAM_GATEWAY_URL?.trim() || undefined,
  };
}
