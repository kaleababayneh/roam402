/**
 * src/routes/schema.ts — GET /schema?route=… : what inputs does a route take?
 *
 * Free endpoint powering the playground's labeled parameter forms. Sources,
 * best first:
 *   native      — our own discovery declarations (routes/native.ts)
 *   origin-402  — the origin's unpaid 402 challenge carries the same bazaar
 *                 discovery extension we publish: queryParams examples, a
 *                 required list, per-param descriptions, POST body examples.
 *                 Fetching it costs nothing (no payment is ever attached).
 *   origin-error— origins that validate before charging (400 on bad input)
 *                 name the missing parameter in their error text; we parse it.
 *   none        — the UI falls back to a structured name/value builder.
 *
 * Results are cached in KV (24h positive / 1h empty) plus an isolate memo,
 * so browsing the playground never hammers origins.
 */

import { Hono } from "hono";
import type { AppEnv } from "../lib/appEnv";
import { findRoute } from "../catalog";
import { NATIVE_ROUTES } from "./native";

export interface RouteParam {
  name: string;
  required: boolean;
  example: string;
  description: string;
}

export interface RouteSchema {
  route: string;
  method: "GET" | "POST";
  params: RouteParam[] | null;
  bodyExample: string | null;
  /** True when bodyExample is our heuristic suggestion, not origin-published. */
  bodySuggested?: boolean;
  /** The origin's own usage blurb, when it publishes one. */
  note: string | null;
  /** True when the origin answered a parameterless probe with a plain 402
   * payment gate — strong evidence the route needs no query inputs. */
  bare?: boolean;
  source: "native" | "origin-402" | "origin-error" | "description" | "none";
}

const KV_TTL_S = 24 * 3600;
const KV_TTL_EMPTY_S = 3600;
const PROBE_TIMEOUT_MS = 6_000;
const NAME_RE = /^[A-Za-z0-9_.\-]{1,40}$/;

const clamp = (v: unknown, n: number): string =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);

/* eslint-disable @typescript-eslint/no-explicit-any -- parsing foreign JSON */

/** Accept a full extensions object ({bazaar:…}) or a bare bazaar object. */
function bazaarOf(x: unknown): any {
  const o = x as any;
  if (!o || typeof o !== "object") return null;
  if (o.bazaar) return o.bazaar;
  return o.info || o.schema ? o : null;
}

function fromBazaar(ext: unknown): { params: RouteParam[] | null; bodyExample: string | null } {
  const bz = bazaarOf(ext);
  if (!bz) return { params: null, bodyExample: null };

  const input = bz.info?.input ?? {};
  const examples: Record<string, unknown> =
    input.queryParams && typeof input.queryParams === "object" ? input.queryParams : {};
  const qpSchema = bz.schema?.properties?.input?.properties?.queryParams;
  const required: string[] = Array.isArray(qpSchema?.required)
    ? qpSchema.required.filter((r: unknown) => typeof r === "string")
    : [];
  const props: Record<string, any> =
    qpSchema?.properties && typeof qpSchema.properties === "object" ? qpSchema.properties : {};

  const names = [...new Set([...required, ...Object.keys(props), ...Object.keys(examples)])]
    .filter((n) => NAME_RE.test(n))
    .slice(0, 12);
  const params: RouteParam[] = names.map((n) => ({
    name: n,
    required: required.includes(n),
    example: clamp(examples[n], 120),
    description: clamp(props[n]?.description, 160),
  }));
  // An origin that declares an input block with zero query params is telling
  // us the route takes none — that is knowledge, not absence of it. Empty
  // array = "declared none"; null = "nothing declared".
  const declaredInput = !!(bz.info?.input || bz.schema?.properties?.input);

  let bodyExample: string | null = null;
  const body = input.body ?? input.bodyExample ?? null;
  if (body && typeof body === "object") {
    try {
      bodyExample = JSON.stringify(body, null, 2).slice(0, 2_000);
    } catch {
      /* unserialisable example — skip */
    }
  } else if (typeof body === "string") {
    bodyExample = body.slice(0, 2_000);
  }

  return { params: params.length ? params : declaredInput ? [] : null, bodyExample };
}

function decodeChallengeHeader(raw: string | null): any {
  if (!raw) return null;
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    // atob yields a byte string; decode as UTF-8 or CJK descriptions mojibake.
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
  } catch {
    return null;
  }
}

/** Sensible starting bodies for the huge OpenAI/Anthropic-compatible family,
 * used only when the origin publishes no example of its own. */
type BodyFamily = "embeddings" | "chat" | "completions" | "messages" | "speech" | "images" | "moderations";
const BODY_TEMPLATES: [RegExp, BodyFamily, () => Record<string, unknown>][] = [
  [/embeddings?$/i, "embeddings", () => ({ model: "text-embedding-3-small", input: "The quick brown fox jumps over the lazy dog" })],
  [/chat\/completions$/i, "chat", () => ({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hello" }] })],
  [/(?<!chat\/)completions$/i, "completions", () => ({ model: "gpt-3.5-turbo-instruct", prompt: "hello", max_tokens: 32 })],
  [/messages$/i, "messages", () => ({ model: "claude-3-5-haiku-latest", max_tokens: 128, messages: [{ role: "user", content: "hello" }] })],
  [/(audio\/speech|tts)$/i, "speech", () => ({ model: "tts-1", input: "Hello from roam402", voice: "alloy" })],
  [/images\/generations$/i, "images", () => ({ model: "dall-e-3", prompt: "a tiny satellite orbiting a planet", n: 1, size: "1024x1024" })],
  [/moderations$/i, "moderations", () => ({ model: "omni-moderation-latest", input: "hello" })],
];
const MODEL_ID_RE = /^[A-Za-z0-9/_.:\-]{1,64}$/;

/** LLM routers expose a sibling /models list (usually free). Read it and pick
 * a real model for the family instead of guessing names the service may not
 * serve ("Unknown model: …"). */
async function discoverModel(originUrl: string, family: BodyFamily): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(originUrl);
  } catch {
    return null;
  }
  const stripped = u.pathname
    .replace(/\/(chat\/completions|completions|messages|embeddings|audio\/speech|tts|images\/generations|moderations)\/?$/i, "");
  const modelsUrl = `${u.origin}${stripped.replace(/\/$/, "")}/models`;
  try {
    const res = await fetch(modelsUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const j = (await res.json()) as any;
    const list: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : Array.isArray(j) ? j : [];
    const ids = list
      .map((m) => (typeof m === "string" ? m : m?.id))
      .filter((x): x is string => typeof x === "string" && MODEL_ID_RE.test(x));
    if (!ids.length) return null;
    const pick = (re: RegExp) => ids.find((id) => re.test(id));
    if (family === "messages") return pick(/claude|anthropic/i) ?? ids[0]!;
    if (family === "embeddings") return pick(/embed/i) ?? ids[0]!;
    if (family === "speech") return pick(/tts|speech|audio/i) ?? ids[0]!;
    if (family === "images") return pick(/dall|image|flux|sd/i) ?? ids[0]!;
    if (family === "moderations") return pick(/moderat/i) ?? ids[0]!;
    // chat/completions: prefer a cheap tier, else the service's first model
    return pick(/mini|flash|haiku|small|lite|nano/i) ?? ids[0]!;
  } catch {
    return null;
  }
}

async function suggestBody(originUrl: string): Promise<string | null> {
  let path = "";
  try {
    path = new URL(originUrl).pathname;
  } catch {
    return null;
  }
  for (const [re, family, tpl] of BODY_TEMPLATES) {
    if (!re.test(path)) continue;
    const body = tpl();
    if ("model" in body) {
      const real = await discoverModel(originUrl, family);
      if (real) body.model = real;
    }
    return JSON.stringify(body, null, 2);
  }
  return null;
}

/** Parse "Missing required query parameter: username"-style validation text. */
const JUNK_NAMES = new Set(["null", "true", "false", "undefined", "error", "message", "code", "param", "params", "parameter", "required", "query", "body"]);
function paramFromErrorText(text: string): string | null {
  const m =
    text.match(/param(?:eter)?s?\s*[:'"]+\s*([A-Za-z0-9_\-]{1,40})/i) ??
    text.match(/missing\s+(?:required\s+)?['"]?([A-Za-z0-9_\-]{1,40})['"]?/i) ??
    text.match(/['"]([A-Za-z0-9_\-]{1,40})['"]\s+is\s+required/i);
  const name = m?.[1];
  if (!name || !NAME_RE.test(name) || JUNK_NAMES.has(name.toLowerCase())) return null;
  return name;
}

async function probeOrigin(originUrl: string, method: "GET" | "POST"): Promise<Omit<RouteSchema, "route" | "method">> {
  const none: Omit<RouteSchema, "route" | "method"> = { params: null, bodyExample: null, note: null, source: "none" };
  let res: Response;
  try {
    res = await fetch(originUrl, {
      method,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: {
        Accept: "application/json, */*",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
  } catch {
    return none;
  }

  // x402 v2 header, else v1-style JSON body on a 402.
  let challenge = decodeChallengeHeader(res.headers.get("PAYMENT-REQUIRED"));
  if (!challenge && res.status === 402) {
    challenge = await res.json().catch(() => null);
  }
  if (challenge) {
    const { params, bodyExample } = fromBazaar(challenge.extensions);
    const note = clamp(challenge.resource?.description, 240) || null;
    if (params === null && res.status === 402) {
      // The origin took our bare request straight to the payment gate: had it
      // required query params it would have rejected first (like twit.sh does).
      return { params: [], bodyExample, note, bare: true, source: "origin-402" };
    }
    return { params, bodyExample, note, source: params !== null || bodyExample ? "origin-402" : "none" };
  }
  if (res.status === 402) {
    // 402 without a decodable challenge: still a payment gate reached bare.
    return { params: [], bodyExample: null, note: null, bare: true, source: "origin-402" };
  }

  // Origins that validate inputs before charging answer 4xx with the missing
  // field named in the body — the next best schema we can get for free.
  if (res.status >= 400 && res.status < 500) {
    const text = clamp(await res.text().catch(() => ""), 300);
    // POST inputs live in the body, so query-param inference is GET-only.
    const name = method === "GET" ? paramFromErrorText(text) : null;
    if (name) {
      return {
        params: [{ name, required: true, example: "", description: "Inferred from the service's validation error." }],
        bodyExample: null,
        note: text || null,
        source: "origin-error",
      };
    }
    return { ...none, note: text || null };
  }
  return none;
}

/** Last resort: mine "?key=value" patterns and "param: x" mentions out of the
 * catalog description so the builder is never a pair of blank boxes. */
function paramsFromText(text: string): RouteParam[] | null {
  const found = new Map<string, string>();
  for (const m of text.matchAll(/[?&]([A-Za-z0-9_]{1,30})=([A-Za-z0-9_.:%{}\-]{1,40})?/g)) {
    const name = m[1]!;
    if (!JUNK_NAMES.has(name.toLowerCase()) && NAME_RE.test(name)) found.set(name, m[2] ?? "");
  }
  const single = paramFromErrorText(text);
  if (single && !found.has(single)) found.set(single, "");
  if (!found.size) return null;
  return [...found.entries()].slice(0, 8).map(([name, example]) => ({
    name,
    required: false,
    example: clamp(example.replace(/[{}]/g, ""), 60),
    description: "From the route description — adjust if the call complains.",
  }));
}

const memo = new Map<string, RouteSchema>();

export function mountSchema(app: Hono<AppEnv>, kv: KVNamespace | undefined): void {
  app.get("/schema", async (c) => {
    const route = c.req.query("route") ?? "";

    const native = NATIVE_ROUTES.find((n) => n.path === route);
    if (native) {
      const { params, bodyExample } = fromBazaar(native.discovery);
      const out: RouteSchema = { route, method: "GET", params, bodyExample, note: clamp(native.description, 240) || null, source: "native" };
      c.header("Cache-Control", "public, max-age=300");
      return c.json(out);
    }

    if (!route.startsWith("/r/")) {
      return c.json({ error: "unknown_route", message: "Pass ?route=/r/<slug> or a native path like /trust" }, 404);
    }
    const rt = findRoute(route.slice(3));
    if (!rt) return c.json({ error: "unknown_route", message: `No such route ${route}` }, 404);

    const cached = memo.get(route);
    if (cached) {
      c.header("Cache-Control", "public, max-age=300");
      return c.json(cached);
    }
    const kvKey = `schema:v6:${route}`;
    const snap = await kv?.get<RouteSchema>(kvKey, "json").catch(() => null);
    if (snap) {
      memo.set(route, snap);
      c.header("Cache-Control", "public, max-age=300");
      return c.json(snap);
    }

    const probed = await probeOrigin(rt.originUrl, rt.method);
    const out: RouteSchema = { route, method: rt.method, ...probed };
    if (out.params === null && rt.method === "GET") {
      const mined = paramsFromText(`${rt.description} ${out.note ?? ""}`);
      if (mined) {
        out.params = mined;
        out.source = "description";
      }
    }
    if (rt.method === "POST" && !out.bodyExample) {
      const suggested = await suggestBody(rt.originUrl);
      if (suggested) {
        out.bodyExample = suggested;
        out.bodySuggested = true;
      }
    }
    memo.set(route, out);
    await kv
      ?.put(kvKey, JSON.stringify(out), { expirationTtl: out.source === "none" ? KV_TTL_EMPTY_S : KV_TTL_S })
      .catch(() => {});
    c.header("Cache-Control", "public, max-age=300");
    return c.json(out);
  });
}
