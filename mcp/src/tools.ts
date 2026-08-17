/**
 * mcp/src/tools.ts — the five Roam402 tools, registered on an McpServer.
 *
 * Design rules:
 *  - Every paid tool states its price in the description — agents budget.
 *  - Responses are truncated at MAX_TEXT so a large origin payload can
 *    never blow up the agent's context; receipts are always included.
 *  - Tool handlers never throw raw — errors come back as isError content
 *    so the agent can read and react (e.g. "insufficient USDC").
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import algosdk from "algosdk";
import type { RoamClient } from "roam402";
import { ALGOD_URL, USDC_ASA, type McpConfig } from "./config.js";

const MAX_TEXT = 8_000;

interface ToolText {
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

const ok = (text: string): ToolText => ({ content: [{ type: "text", text }] });
const fail = (err: unknown): ToolText => ({
  isError: true,
  content: [{ type: "text", text: `roam402 error: ${err instanceof Error ? err.message : String(err)}` }],
});

const clip = (s: string): string =>
  s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n…[truncated ${s.length - MAX_TEXT} chars]` : s;

/** Receipt lines appended to every paid call result. */
function receiptLines(res: Response): string {
  const parts = [
    ["algorand settlement", res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE")],
    ["origin receipt", res.headers.get("X-Roam-Origin-Receipt")],
    ["origin chain", res.headers.get("X-Roam-Origin-Chain")],
    ["trust tier", res.headers.get("X-Roam-Trust-Tier")],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${(v as string).slice(0, 100)}`);
  return parts.length ? `\n\n— receipts —\n${parts.join("\n")}` : "";
}

/** Shown by every paid tool when the server is running without a wallet. */
const NO_WALLET =
  "No wallet is configured, so paid tools are unavailable — nothing was charged. " +
  "Set ROAM_MNEMONIC (25-word Algorand mnemonic) in this MCP server's env config, " +
  "or run `npx roam402-mcp` in a terminal to create a wallet. " +
  "roam_catalog and roam_schema work without one.";

export function registerTools(
  server: McpServer,
  roam: RoamClient,
  cfg: McpConfig,
  /** undefined → read-only mode. */
  address?: string
): void {
  const needsWallet = () => (address ? null : ok(NO_WALLET));
  server.registerTool(
    "roam_catalog",
    {
      title: "Browse the Roam402 catalog",
      description:
        "FREE. Discover x402 services callable through Roam402 on Algorand. WITHOUT arguments: a compact summary (categories + top services). WITH search/category/service: matching routes with slugs and USDC prices. Drill down rather than listing everything — the catalog holds 700+ services.",
      inputSchema: {
        search: z.string().optional().describe("Free-text search over route, service and description"),
        category: z.string().optional().describe("Filter by category, e.g. market_data, ai_inference"),
        service: z.string().optional().describe("Filter by origin service domain, e.g. quickintel.io"),
        tier: z.string().optional().describe("Exact trust tier: Corroborated, Established, Emerging, Listed"),
        method: z.enum(["GET", "POST"]).optional().describe("Only GET or only POST routes"),
        max_price: z.number().optional().describe("Only routes at or below this USDC price"),
        offset: z.number().optional().describe("Page offset — the previous call reports total and returned"),
      },
    },
    async ({ search, category, service, tier, method, max_price, offset }) => {
      try {
        if (!search && !category && !service && !tier && !method && max_price == null) {
          // Summary mode: the gateway's aggregate stats cover the FULL
          // catalog even though the unfiltered payload is truncated at 500.
          const cat = await roam.catalog();
          const stats = cat.stats;
          const byCategory: [string, { services: number; routes: number }][] = stats
            ? Object.entries(stats.byCategory)
            : [...new Map(cat.wrapped.map((w) => [w.category ?? "other", { services: 1, routes: 1 }])).entries()];
          const lines = [
            `ROAM402 CATALOG — ${byCategory.length} categories · ${stats?.services ?? "?"} services · ${stats?.routes ?? cat.wrapped.length} routes`,
            "",
            "NATIVE (trust layer):",
            ...cat.native.map((n) => `  ${n.path} · ${n.price} — ${n.description.slice(0, 100)}`),
            "",
            "CATEGORIES (call again with {category} or {search} to drill down):",
            ...byCategory
              .sort((a, b) => b[1].routes - a[1].routes)
              .map(([k, e]) => `  ${k}: ${e.services} services · ${e.routes} routes`),
          ];
          return ok(clip(lines.join("\n")));
        }
        const cat = await roam.catalog({
          q: search, category, service, tier, method, maxPrice: max_price,
          limit: 40, offset,
        });
        const shown = (cat.offset ?? 0) + cat.wrapped.length;
        const more = cat.total > shown ? ` — call again with offset=${shown} for the next page` : "";
        const lines = [
          `MATCHES ${(cat.offset ?? 0) + 1}-${shown} of ${cat.total}${more}:`,
          ...cat.wrapped.map(
            (w) => `  ${w.path} · ${w.price} · ${w.service} (${w.trust_tier}) — ${w.description.slice(0, 90)}`
          ),
        ];
        return ok(clip(lines.join("\n")));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "roam_trust",
    {
      title: "Trust report for an x402 seller",
      description:
        "PAID ($0.0005 USDC on Algorand). Agents-Trust tier (Corroborated/Established/Emerging/Listed), score, and verified on-chain volume for a seller domain — from $45M+ of indexed settlement. Use before relying on any seller.",
      inputSchema: { domain: z.string().describe("Seller domain, e.g. blockrun.ai") },
    },
    async ({ domain }) => {
      const missing = needsWallet();
      if (missing) return missing;
      try {
        return ok(JSON.stringify(await roam.trust(domain), null, 2));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "roam_precheck",
    {
      title: "Safety precheck for an x402 endpoint URL",
      description:
        "PAID ($0.0002 USDC on Algorand). Before paying an UNKNOWN x402 endpoint: is the seller known, what trust tier, should you pay? Cheap insurance against dead or scam endpoints.",
      inputSchema: { url: z.string().describe("Full endpoint URL to check") },
    },
    async ({ url }) => {
      const missing = needsWallet();
      if (missing) return missing;
      try {
        return ok(JSON.stringify(await roam.precheck(url), null, 2));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "roam_call",
    {
      title: "Call a wrapped x402 service (paid)",
      description:
        "PAID (price per roam_catalog; settles USDC on Algorand, fulfilled on the origin chain with dual receipts). Call a catalog route by slug. Provide query params for GET routes, json_body for POST routes (e.g. blockrun-chat-completions expects an OpenAI-style body).",
      inputSchema: {
        slug: z.string().describe("Route slug from roam_catalog, e.g. quickintel-scan-full"),
        query: z.record(z.string()).optional().describe("Query parameters (GET routes)"),
        json_body: z.unknown().optional().describe("JSON body (POST routes)"),
      },
    },
    async ({ slug, query, json_body }) => {
      const missing = needsWallet();
      if (missing) return missing;
      try {
        const res = await roam.call(slug, {
          query: query as Record<string, string> | undefined,
          body: json_body,
        });
        const text = await res.text();
        if (!res.ok) {
          // A 402 surviving the paying fetch means the payment never went
          // through — say so, rather than echoing an empty body at the agent.
          if (res.status === 402) {
            return fail(
              new Error(
                "payment required but NOT completed — this wallet could not pay. " +
                  "Run roam_balance: it needs USDC for the price, ALGO for fees, and " +
                  "an opt-in to the USDC asset. Nothing was charged."
              )
            );
          }
          return fail(new Error(`HTTP ${res.status}: ${clip(text)}`));
        }
        return ok(clip(text) + receiptLines(res));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "roam_resolve",
    {
      title: "Find routes from a plain-English request",
      description:
        "PAID ($0.0005). Describe what you need in plain English and get a RANKED SHORTLIST of matching routes with prices, trust tiers and input schemas. Prefer this over browsing when you know the capability but not the slug. It only suggests: it never calls a route and never spends beyond its own fee — pick a candidate, then roam_schema it and roam_call it.",
      inputSchema: {
        intent: z.string().describe('What you need, e.g. "check a token for honeypots before buying"'),
        limit: z.number().optional().describe("Candidates to return (default 5, max 10)"),
        max_price: z.number().optional().describe("Only consider routes at or below this USDC price"),
      },
    },
    async ({ intent, limit, max_price }) => {
      const missing = needsWallet();
      if (missing) return missing;
      try {
        const r = await roam.resolve(intent, { limit, maxPrice: max_price });
        if (!r.candidates.length) {
          return ok(`No route matched "${intent}". Try roam_catalog with a broader search term.`);
        }
        const lines = [
          `SHORTLIST for "${r.intent}" (${r.total_matches} matched, ranked by ${r.ranked_by}):`,
          ...r.candidates.map((c, i) => {
            const slug = c.path.replace(/^\/r\//, "");
            const matched = c.matched.length ? ` [matched: ${c.matched.join(", ")}]` : "";
            // `why` is model text about third-party listings — label it as such.
            const why = c.why ? `\n       note (model): ${c.why}` : "";
            return `  ${i + 1}. ${slug} · ${c.price} · ${c.service} (${c.trust_tier})\n       ${c.description}${matched}${why}`;
          }),
          "",
          "Nothing has been charged for these routes. roam_schema <slug> for inputs, then roam_call.",
        ];
        return ok(clip(lines.join("\n")));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "roam_schema",
    {
      title: "What inputs a route expects",
      description:
        "FREE. The query parameters or JSON body a catalog route expects, probed from the origin's own x402 challenge. Call this before roam_call on an unfamiliar route so you send the right fields instead of guessing.",
      inputSchema: {
        slug: z.string().describe("Route slug, e.g. blockrun-chat-completions"),
      },
    },
    async ({ slug }) => {
      try {
        const s = await roam.schema(slug);
        const params = s.params?.length
          ? s.params.map((p) => `  ${p.name}${p.required ? "*" : ""}${p.example ? ` (e.g. ${p.example})` : ""}${p.description ? ` — ${p.description}` : ""}`)
          : s.params
            ? ["  (the origin declares no query parameters)"]
            : ["  (unknown — the origin publishes no schema; try roam_call and read the error)"];
        const lines = [
          `${s.method} ${s.route}  [source: ${s.source}]`,
          "PARAMS (* = required):",
          ...params,
          ...(s.bodyExample ? ["", "BODY EXAMPLE:", s.bodyExample] : []),
          ...(s.note ? ["", `NOTE: ${s.note}`] : []),
        ];
        return ok(clip(lines.join("\n")));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "roam_optin",
    {
      title: "Opt this wallet in to USDC (required before it can be paid)",
      description:
        "FREE (costs ~0.001 ALGO in network fees). An Algorand account cannot RECEIVE an asset it has not opted into, so a new wallet must do this once before anyone sends it USDC. Sends the 0-amount self-transfer that constitutes the opt-in. Idempotent: reports and does nothing if already opted in. Requires a little ALGO in the wallet first.",
      inputSchema: {},
    },
    async () => {
      const missing = needsWallet();
      if (missing) return missing;
      try {
        const asa = USDC_ASA[cfg.network];
        const algod = new algosdk.Algodv2("", ALGOD_URL[cfg.network], "");
        const info = await algod.accountInformation(address!).do();
        const algo = Number(info.amount) / 1e6;

        if ((info.assets ?? []).some((a) => Number(a.assetId) === asa)) {
          return ok(`Already opted in to USDC (asset ${asa}) on ${cfg.network}. Nothing to do.`);
        }
        // 0.1 base + 0.1 per asset + fee; refuse rather than broadcast a
        // transaction that the network will reject for min-balance.
        if (algo < 0.21) {
          return ok(
            `Not enough ALGO to opt in: this wallet holds ${algo} ALGO and needs ~0.21 ` +
              `(0.1 minimum balance + 0.1 more to hold an asset + fees). ` +
              `Send ALGO to ${address} first, then run roam_optin again.`
          );
        }

        const sk = algosdk.mnemonicToSecretKey(cfg.mnemonic!).sk;
        const params = await algod.getTransactionParams().do();
        const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender: address!,
          receiver: address!,
          amount: 0,
          assetIndex: asa,
          suggestedParams: params,
        });
        const { txid } = await algod.sendRawTransaction(txn.signTxn(sk)).do();
        await algosdk.waitForConfirmation(algod, txid, 6);
        return ok(
          `Opted in to USDC (asset ${asa}) on ${cfg.network}. Transaction ${txid}. ` +
            `This wallet can now receive USDC — send some to ${address}, then run roam_balance.`
        );
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "roam_balance",
    {
      title: "Check the paying wallet's balance",
      description:
        "FREE. ALGO and USDC balance of this agent's Algorand wallet — check before paid calls if unsure of funds.",
      inputSchema: {},
    },
    async () => {
      if (!address) {
        return ok(
          "No wallet is configured — there is no balance to report. " +
            "Set ROAM_MNEMONIC, or run `npx roam402-mcp` in a terminal to create a wallet."
        );
      }
      try {
        const algod = new algosdk.Algodv2("", ALGOD_URL[cfg.network], "");
        const info = await algod.accountInformation(address).do();
        const usdc = (info.assets ?? []).find((a) => Number(a.assetId) === USDC_ASA[cfg.network]);
        return ok(
          JSON.stringify(
            {
              address,
              network: cfg.network,
              algo: Number(info.amount) / 1e6,
              usdc: usdc ? Number(usdc.amount) / 1e6 : "not opted in",
            },
            null,
            2
          )
        );
      } catch (err) {
        return fail(err);
      }
    }
  );
}
