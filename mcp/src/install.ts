/**
 * mcp/src/install.ts — `npx roam402-mcp install`.
 *
 * Handing someone a block of JSON and telling them to find the right config
 * file is the worst part of adopting any MCP server: four clients, four
 * formats, four paths that differ per OS, and a syntax error means the server
 * silently never appears. This wires it up instead.
 *
 * Rules, because this edits files the user did not ask us to own:
 *   - never clobber: existing servers are preserved, we only add our key
 *   - back up first, next to the original, with a timestamp
 *   - idempotent: re-running reports "already configured" and writes nothing
 *   - confirm before writing, unless --yes
 *   - print the JSON and stop if we cannot safely edit (--print, or an
 *     unknown client) so the manual path always remains
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import { defaultKeyPath, type RoamNetwork } from "./config.js";

const B = (s: string) => `\u001b[1m${s}\u001b[0m`;
const DIM = (s: string) => `\u001b[2m${s}\u001b[0m`;
const OK = (s: string) => `\u001b[32m${s}\u001b[0m`;
const WARN = (s: string) => `\u001b[33m${s}\u001b[0m`;

const SERVER_NAME = "roam402";

export interface InstallOptions {
  network: RoamNetwork;
  /** Restrict to one client id; otherwise every detected client is offered. */
  only?: string;
  yes?: boolean;
}

interface Client {
  id: string;
  label: string;
  /** Where the change lands, for display. */
  where: string;
  /** True when this client looks installed on this machine. */
  detect(): boolean;
  /** Returns a human line describing what happened. */
  apply(env: Record<string, string>): string;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function backup(file: string): void {
  if (!existsSync(file)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(file, `${file}.bak-${stamp}`);
}

function readJson(file: string): Record<string, any> {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
  } catch {
    // A malformed config is the user's, not ours to rewrite.
    throw new Error(`${file} is not valid JSON — fix or move it, then re-run`);
  }
}

/** Merge our server into an mcpServers-shaped JSON config. */
function mergeJsonConfig(file: string, entry: Record<string, unknown>): string {
  const cfg = readJson(file);
  const servers = (cfg.mcpServers ??= {});
  if (JSON.stringify(servers[SERVER_NAME]) === JSON.stringify(entry)) {
    return "already configured — nothing to do";
  }
  const replacing = !!servers[SERVER_NAME];
  servers[SERVER_NAME] = entry;
  mkdirSync(dirname(file), { recursive: true });
  backup(file);
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  return replacing ? `updated ${file}` : `added to ${file}`;
}

function desktopConfigPath(): string {
  const home = homedir();
  if (platform() === "darwin") {
    return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }
  return join(home, ".config", "Claude", "claude_desktop_config.json");
}

function hasCommand(bin: string): boolean {
  try {
    execFileSync(platform() === "win32" ? "where" : "which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/* ── clients ─────────────────────────────────────────────────────────────── */

function clients(): Client[] {
  const desktop = desktopConfigPath();
  const cursor = join(homedir(), ".cursor", "mcp.json");
  const codex = join(homedir(), ".codex", "config.toml");

  return [
    {
      id: "claude-code",
      label: "Claude Code",
      where: "via the claude CLI",
      detect: () => hasCommand("claude"),
      apply(env) {
        // Its config is large and CLI-owned; let the CLI write it. Scope
        // "user" matters: the default is "local", which would wire the server
        // into the ONE directory install happened to run in.
        const args = ["mcp", "add", "--scope", "user", SERVER_NAME];
        for (const [k, v] of Object.entries(env)) args.push("-e", `${k}=${v}`);
        args.push("--", "npx", "roam402-mcp");
        try {
          execFileSync("claude", args, { stdio: "pipe" });
          return "added via `claude mcp add`";
        } catch (err) {
          const out = String((err as { stderr?: Buffer }).stderr ?? err);
          if (/already exists/i.test(out)) return "already configured — nothing to do";
          throw new Error(out.trim().split("\n")[0] || "claude mcp add failed");
        }
      },
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      where: desktop,
      // The app may be installed before it has ever written a config.
      detect: () => existsSync(desktop) || existsSync(dirname(desktop)),
      apply: (env) => mergeJsonConfig(desktop, { command: "npx", args: ["roam402-mcp"], env }),
    },
    {
      id: "cursor",
      label: "Cursor",
      where: cursor,
      detect: () => existsSync(cursor) || hasCommand("cursor"),
      apply: (env) => mergeJsonConfig(cursor, { command: "npx", args: ["roam402-mcp"], env }),
    },
    {
      id: "codex",
      label: "Codex CLI",
      where: codex,
      detect: () => existsSync(codex) || hasCommand("codex"),
      apply(env) {
        // TOML, and we will not pull in a parser to rewrite someone's config:
        // append our table only when it is absent, leaving everything else byte
        // for byte as it was.
        const existing = existsSync(codex) ? readFileSync(codex, "utf8") : "";
        if (/^\s*\[mcp_servers\.roam402\]/m.test(existing)) {
          return "already configured — nothing to do (edit by hand to change it)";
        }
        const envLines = Object.entries(env)
          .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
          .join("\n");
        const block =
          `\n[mcp_servers.${SERVER_NAME}]\n` +
          `command = "npx"\n` +
          `args = ["roam402-mcp"]\n` +
          (envLines ? `\n[mcp_servers.${SERVER_NAME}.env]\n${envLines}\n` : "");
        mkdirSync(dirname(codex), { recursive: true });
        backup(codex);
        writeFileSync(codex, existing.replace(/\s*$/, "\n") + block);
        return `appended to ${codex}`;
      },
    },
  ];
}

/** The env every client entry carries. */
function serverEnv(network: RoamNetwork): Record<string, string> {
  const env: Record<string, string> = { ROAM_NETWORK: network };
  // Absolute, because another process expands it, not your shell.
  const key = defaultKeyPath(network);
  if (existsSync(key)) env.ROAM_MNEMONIC_FILE = key;
  return env;
}

export function configSnippetFor(network: RoamNetwork): string {
  return JSON.stringify(
    {
      mcpServers: {
        [SERVER_NAME]: { command: "npx", args: ["roam402-mcp"], env: serverEnv(network) },
      },
    },
    null,
    2
  );
}

/* ── command ─────────────────────────────────────────────────────────────── */

export async function runInstall(opts: InstallOptions): Promise<number> {
  const env = serverEnv(opts.network);
  const all = clients();
  const chosen = opts.only
    ? all.filter((c) => c.id === opts.only)
    : all.filter((c) => c.detect());

  if (opts.only && chosen.length === 0) {
    console.error(`Unknown client "${opts.only}". Known: ${all.map((c) => c.id).join(", ")}`);
    return 1;
  }

  if (chosen.length === 0) {
    stdout.write(`
No agent found to configure automatically. Add this to your client's MCP
config by hand:

${configSnippetFor(opts.network)}
`);
    return 0;
  }

  stdout.write(`\n${B("roam402-mcp install")} — wiring the gateway into your agent(s):\n\n`);
  for (const c of chosen) stdout.write(`  • ${B(c.label)} ${DIM(c.where)}\n`);
  if (!env.ROAM_MNEMONIC_FILE) {
    stdout.write(
      `\n${WARN("No wallet found")} — the free tools will work; run ${B("npx roam402-mcp")}\n` +
        `to create a wallet, then re-run install to point at it.\n`
    );
  }

  if (!opts.yes && stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    let answer = "";
    try {
      answer = (await rl.question(`\nEdit ${chosen.length === 1 ? "this config" : "these configs"}? ${DIM("[Y/n]")} `))
        .trim()
        .toLowerCase();
    } catch {
      answer = "n";
    } finally {
      rl.close();
    }
    if (answer === "n" || answer === "no") {
      stdout.write(`\nNothing changed. The manual snippet:\n\n${configSnippetFor(opts.network)}\n`);
      return 0;
    }
  }

  stdout.write("\n");
  let failures = 0;
  for (const c of chosen) {
    try {
      stdout.write(`  ${OK("✓")} ${c.label}: ${c.apply(env)}\n`);
    } catch (err) {
      failures++;
      stdout.write(`  ${WARN("✗")} ${c.label}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  stdout.write(
    `\n${OK("Done.")} Restart the app(s) you just configured, then ask:\n` +
      `  ${DIM('"what can I buy through roam402?"')}\n` +
      `${DIM("Existing servers were left untouched; each edited file has a .bak- copy.")}\n`
  );
  return failures > 0 ? 1 : 0;
}
