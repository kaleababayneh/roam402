/**
 * mcp/src/wallet.ts — the on-chain wallet chores, shared by the MCP tool and
 * the CLI.
 *
 * These exist as plain functions rather than only as MCP tools because of a
 * chicken-and-egg problem: a wallet must be opted in to USDC before it can
 * receive any, but an MCP tool is only callable once an agent host is
 * configured — which is the step AFTER funding. So `npx roam402-mcp --optin`
 * and the roam_optin tool both call in here, and a user with no wallet app
 * and no agent host can still finish setup.
 */

import algosdk from "algosdk";
import { ALGOD_URL, USDC_ASA, type McpConfig } from "./config.js";

/** Base minimum balance (0.1) + one asset holding (0.1) + room for fees. */
export const MIN_ALGO_TO_OPT_IN = 0.21;

export interface WalletStatus {
  address: string;
  network: string;
  algo: number;
  optedIn: boolean;
  /** null when not opted in — "0" and "cannot hold any" are different facts. */
  usdc: number | null;
}

export async function walletStatus(cfg: McpConfig, address: string): Promise<WalletStatus> {
  const algod = new algosdk.Algodv2("", ALGOD_URL[cfg.network], "");
  const info = await algod.accountInformation(address).do();
  const holding = (info.assets ?? []).find((a) => Number(a.assetId) === USDC_ASA[cfg.network]);
  return {
    address,
    network: cfg.network,
    algo: Number(info.amount) / 1e6,
    optedIn: !!holding,
    usdc: holding ? Number(holding.amount) / 1e6 : null,
  };
}

export type OptInOutcome =
  | { kind: "already"; message: string }
  | { kind: "underfunded"; message: string }
  | { kind: "done"; txid: string; message: string };

/**
 * Send the 0-amount self asset-transfer that opts an account in to USDC.
 * Idempotent, and it refuses on an underfunded account rather than
 * broadcasting a transaction the network will reject for minimum balance.
 */
export async function optInToUsdc(cfg: McpConfig, address: string): Promise<OptInOutcome> {
  const asa = USDC_ASA[cfg.network];
  const algod = new algosdk.Algodv2("", ALGOD_URL[cfg.network], "");
  const status = await walletStatus(cfg, address);

  if (status.optedIn) {
    return {
      kind: "already",
      message: `Already opted in to USDC (asset ${asa}) on ${cfg.network}. Nothing to do.`,
    };
  }
  if (status.algo < MIN_ALGO_TO_OPT_IN) {
    return {
      kind: "underfunded",
      message:
        `Not enough ALGO to opt in. This wallet holds ${status.algo} ALGO and needs ` +
        `${MIN_ALGO_TO_OPT_IN} (0.1 to exist, 0.1 more to hold an asset, plus fees). ` +
        `Send ALGO to ${address}\n\n` +
        (cfg.network === "mainnet"
          ? `ALGO is a real asset you have to buy. Get it from any exchange that ` +
            `lists ALGO (Coinbase, Kraken, Binance) and withdraw to the address ` +
            `above, choosing the Algorand network. 1 ALGO is far more than enough.\n\n` +
            `To try roam402 for free instead, use testnet: set ROAM_NETWORK=testnet, ` +
            `run the wizard again, and fund it from the Algorand testnet faucet at ` +
            `https://bank.testnet.algorand.network`
          : `This is testnet, so the ALGO is free: paste the address into the faucet ` +
            `at https://bank.testnet.algorand.network and run this again.`),
    };
  }

  const sk = algosdk.mnemonicToSecretKey(cfg.mnemonic!).sk;
  const params = await algod.getTransactionParams().do();
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: address,
    receiver: address,
    amount: 0,
    assetIndex: asa,
    suggestedParams: params,
  });
  const { txid } = await algod.sendRawTransaction(txn.signTxn(sk)).do();
  await algosdk.waitForConfirmation(algod, txid, 6);
  return {
    kind: "done",
    txid,
    message:
      `Opted in to USDC (asset ${asa}) on ${cfg.network}. Transaction ${txid}. ` +
      `This wallet can now receive USDC — send some to ${address}.`,
  };
}
