/**
 * src/payment/discovery.ts — curated Bazaar discovery for wrapped routes.
 *
 * Honesty rule: we only declare input schemas we actually KNOW. Most wrapped
 * origins don't publish schemas, so most routes carry descriptions only.
 * The OpenAI-compatible chat routes are the exception — their body format is
 * publicly documented, so declaring it is fact, not guesswork.
 */

import { declareDiscoveryExtension } from "@x402/extensions";
import type { RouteConfig } from "@x402/core/server";

const OPENAI_BODY = {
  bodyType: "json" as const,
  input: {
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "One sentence: why pay-per-call?" }],
  },
  inputSchema: {
    type: "object",
    required: ["model", "messages"],
    properties: {
      model: { type: "string", description: "Model id (OpenAI-compatible)" },
      messages: {
        type: "array",
        description: "OpenAI-style chat messages",
        items: {
          type: "object",
          required: ["role", "content"],
          properties: { role: { type: "string" }, content: { type: "string" } },
        },
      },
      max_tokens: { type: "number" },
      stream: { type: "boolean", description: "Streaming is buffered through the gateway" },
    },
  },
  output: {
    example: { choices: [{ message: { role: "assistant", content: "…" } }], usage: { total_tokens: 42 } },
  },
};

const BY_SLUG: Record<string, Record<string, unknown>> = {
  "blockrun-chat-completions": declareDiscoveryExtension(OPENAI_BODY),
  "blockrun-v1-messages": declareDiscoveryExtension(OPENAI_BODY),
};

/** Curated discovery extensions for a wrapped route (empty when unknown). */
export function wrappedRouteExtensions(slug: string): NonNullable<RouteConfig["extensions"]> {
  return (BY_SLUG[slug] as NonNullable<RouteConfig["extensions"]>) ?? {};
}
