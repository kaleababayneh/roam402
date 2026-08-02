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

export function registerTools(server: McpServer, roam: RoamClient, cfg: McpConfig, address: string): void {
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
      },
    },
    async ({ search, category, service }) => {
      try {
        if (!search && !category && !service) {
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
        const cat = await roam.catalog({ q: search, category, service, limit: 60 });
        const lines = [
          `MATCHES (${cat.wrapped.length}${cat.wrapped.length === 60 ? "+, narrow your filter" : ""}):`,
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
      try {
        const res = await roam.call(slug, {
          query: query as Record<string, string> | undefined,
          body: json_body,
        });
        const text = await res.text();
        if (!res.ok) {
          return fail(new Error(`HTTP ${res.status}: ${clip(text)}`));
        }
        return ok(clip(text) + receiptLines(res));
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
